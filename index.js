// index.js — Discord → Roblox Boost Reward Bot (Node 18+ / 22+)
// Now with /resetdata (owner-only) that resets player data by Roblox username or linked Discord user.

'use strict';
require('dotenv').config(); // load env FIRST

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

// ✅ fetch wrapper that works with node-fetch v3 on Render
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

// --- tiny HTTP server so Render keeps us alive ---
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => {
  res.send('BoostRewardBot alive');
});
const PORT = process.env.PORT || 3000;
keepAliveApp.listen(PORT, () => {
  console.log('Keep-alive web server running on port', PORT);
});

// --- Env ---
const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROBLOX_UNIVERSE_ID,
  ROBLOX_API_KEY,
  TOPIC = 'DiscordBoost',
  OWNER_IDS = '',
  DEFAULT_PET_ID = '109999',
  DEFAULT_AMOUNT = '1',
  DEFAULT_RARITY = 'normal', // normal|golden|rainbow|darkmatter|shiny|all
  DATA_DIR = './data',
  DS_NAME = 'DiscordBoostQueue_v1',
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !ROBLOX_UNIVERSE_ID || !ROBLOX_API_KEY) {
  console.error(
    'Missing required env vars. Check .env (DISCORD_TOKEN, GUILD_ID, ROBLOX_UNIVERSE_ID, ROBLOX_API_KEY).'
  );
  process.exit(1);
}

console.log('BoostRewardBot loaded with topic:', TOPIC, 'Universe:', ROBLOX_UNIVERSE_ID);

const OWNER_SET = new Set(
  OWNER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
);

// --- Simple JSON map for DiscordID -> RobloxUsername ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAP_FILE = path.join(DATA_DIR, 'links.json');

function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveMap(m) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages, // for DM interactions
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel, // needed for DM interactions
  ],
});

// --- Helpers ---
function normRarity(s) {
  if (!s) return 'normal';
  s = String(s).toLowerCase();
  const map = {
    normal: 'normal', none: 'normal', default: 'normal',
    gold: 'golden', golden: 'golden',
    rb: 'rainbow', rainbow: 'rainbow',
    dm: 'darkmatter', dark: 'darkmatter', darkmatter: 'darkmatter',
    shiny: 'shiny',
    all: 'all'
  };
  return map[s] || 'normal';
}

function isOwner(discordUserId) {
  return OWNER_SET.has(discordUserId);
}

async function isServerBooster(i) {
  const guild =
    client.guilds.cache.get(GUILD_ID) ||
    (await client.guilds.fetch(GUILD_ID).catch(() => null));
  if (!guild) return false;

  let member;
  try {
    member = await guild.members.fetch(i.user.id);
  } catch {
    return false;
  }

  return Boolean(member?.premiumSince);
}

async function robloxUserIdFromUsername(username) {
  const url = 'https://users.roblox.com/v1/usernames/users';
  const body = { usernames: [username], excludeBannedUsers: false };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('Roblox username lookup failed:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const user = data?.data?.[0];
  return user?.id ?? null;
}

// ---------- Open Cloud: MessagingService (instant) ----------
async function publishToRoblox(topic, payload) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/${encodeURIComponent(
    topic
  )}`;

  console.log('Publishing to Roblox:', {
    universe: ROBLOX_UNIVERSE_ID,
    topic,
    robloxUserId: payload.robloxUserId,
    action: payload.action,
    reward: payload.reward,
    ts: payload.ts,
    type: payload.type,
    performedBy: payload.performedBy,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': ROBLOX_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: JSON.stringify(payload) }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Open Cloud publish failed:', res.status, txt);
    throw new Error(`OpenCloud ${res.status}`);
  }

  console.log('Publish OK');
}

// ---------- Open Cloud: Standard DataStores (offline queue) ----------
async function ocGetQueue(userId) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(
    DS_NAME
  )}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;

  const res = await fetch(u, {
    headers: {
      'x-api-key': ROBLOX_API_KEY,
    },
  });

  if (res.status === 404) {
    // means this user doesn't have a queue saved yet, that's fine
    return { body: { items: [] }, etag: null };
  }

  if (!res.ok) {
    throw new Error(`OC Get DS failed ${res.status}: ${await res.text()}`);
  }

  const etag = res.headers.get('etag');
  let body = {};
  try {
    body = await res.json();
  } catch {}

  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    body = { items: [] };
  }

  return { body, etag };
}

async function ocPutQueue(userId, body, etag) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(
    DS_NAME
  )}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;

  const headers = {
    'x-api-key': ROBLOX_API_KEY,
    'Content-Type': 'application/json',
  };
  if (etag) {
    headers['If-Match'] = etag;
  }

  const res = await fetch(u, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  // 409 / 412 = version conflict, means "retry"
  if (res.status === 409 || res.status === 412) {
    return false;
  }

  if (!res.ok) {
    throw new Error(`OC Put DS failed ${res.status}: ${await res.text()}`);
  }

  return true;
}

async function enqueueViaOpenCloud(robloxUserId, item, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { body, etag } = await ocGetQueue(robloxUserId);
    body.items = Array.isArray(body.items) ? body.items : [];
    body.items.push(item);
    const ok = await ocPutQueue(robloxUserId, body, etag);
    if (ok) {
      console.log('Queued via DataStore for', robloxUserId, item);
      return true;
    }
    await new Promise((r) => setTimeout(r, 200 + 150 * attempt));
  }
  throw new Error('enqueueViaOpenCloud failed after retries');
}

// --- Slash Commands ---
const rarityChoices = [
  ['normal','normal'],
  ['golden','golden'],
  ['rainbow','rainbow'],
  ['darkmatter','darkmatter'],
  ['shiny','shiny'],
  ['all','all'],
];

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Roblox username so boosts reward you in-game.')
    .addStringOption((o) =>
      o.setName('username').setDescription('Your Roblox username').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('claimboost')
    .setDescription('Manually claim the booster pet if you were already boosting.')
    .addStringOption((o) => {
      o.setName('rarity')
       .setDescription('normal | golden | rainbow | darkmatter | shiny | all')
       .setRequired(false);
      rarityChoices.forEach(([name, value]) => o.addChoices({ name, value }));
      return o;
    })
    .toJSON(),

  new SlashCommandBuilder()
    .setName('grantpet')
    .setDescription('[OWNER] Grant a boost reward to anyone, anytime.')
    .addUserOption((o) =>
      o
        .setName('discorduser')
        .setDescription('Discord user to grant (uses their linked Roblox username if set).')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('roblox_username')
        .setDescription('Roblox username to grant directly (if not using discorduser).')
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName('petid')
        .setDescription('Override pet ID for this grant (default from env).')
        .setRequired(false)
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('Amount to grant (default from env).')
        .setRequired(false)
    )
    .addStringOption((o) => {
      o
        .setName('rarity')
        .setDescription('normal | golden | rainbow | darkmatter | shiny | all')
        .setRequired(false);
      rarityChoices.forEach(([name, value]) => o.addChoices({ name, value }));
      return o;
    })
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Optional reason/note for this grant.')
        .setRequired(false)
    )
    .toJSON(),

  // NEW: /resetdata — owner-only, by username or linked discord user
  new SlashCommandBuilder()
    .setName('resetdata')
    .setDescription('[OWNER] Reset a player’s saved data (online OR offline).')
    .addUserOption((o) =>
      o
        .setName('discorduser')
        .setDescription('Discord user (uses their linked Roblox username if set).')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('roblox_username')
        .setDescription('Roblox username to reset directly (if not using discorduser).')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Optional reason for audit trail / in-game notice.')
        .setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands(appId) {
  // fast refresh for your server
  await rest.put(
    Routes.applicationGuildCommands(appId, GUILD_ID),
    { body: commands },
  );
  console.log('Guild slash commands registered.');

  // global so commands show in DM with the bot
  await rest.put(
    Routes.applicationCommands(appId),
    { body: commands },
  );
  console.log('Global slash commands registered (for DMs).');
}

// --- Interaction handler ---
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  // /link
  if (i.commandName === 'link') {
    const username = i.options.getString('username', true).trim();
    const links = loadMap();
    links[i.user.id] = username;
    saveMap(links);
    await i.reply({
      content: `Linked ✅ **${username}**.`,
      ephemeral: true,
    });
    return;
  }

  // /claimboost
  if (i.commandName === 'claimboost') {
    try {
      // check boost in your main server even if they're in DM
      if (!(await isServerBooster(i))) {
        await i.reply({
          content:
            'This command is only for **current server boosters** of our main server. ' +
            'Boost the server first, then run /claimboost.',
          ephemeral: true,
        });
        return;
      }

      if (!i.replied && !i.deferred) {
        await i.deferReply({ ephemeral: true });
      }

      const links = loadMap();
      const username = links[i.user.id];
      if (!username) {
        await i.editReply(
          'You are not linked yet. Run `/link <roblox_username>` first.'
        );
        return;
      }

      const robloxUserId = await robloxUserIdFromUsername(username);
      if (!robloxUserId) {
        await i.editReply(
          `I couldn’t find Roblox user **${username}**. Re-run /link with the correct name.`
        );
        return;
      }

      const petId = Number(DEFAULT_PET_ID) || 109999;
      const amount = Number(DEFAULT_AMOUNT) || 1;
      const rarityOpt = normRarity(
        i.options.getString('rarity', false) || DEFAULT_RARITY
      );

      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost',
          discordId: i.user.id,
          robloxUsername: username,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount, rarity: rarityOpt },
          reason:
            'Thanks for boosting the server! Your reward has been delivered.',
          ts: Date.now(),
        });
      } catch (e) {
        console.warn(
          'Publish failed; offline queue will still deliver:',
          e.message
        );
      }

      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId,
          amount,
          rarity: rarityOpt,
          reason:
            'Thanks for boosting the server! Your reward has been delivered.',
          admin: false,
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }

      await i.editReply(
        `Claim queued ✅ (${rarityOpt}). If a server was online it’s instant; otherwise you’ll get it next time you join.`
      );
    } catch (e) {
      console.error('claimboost error:', e);
      try {
        await i.editReply(
          'Failed to process claim. Check bot console for details.'
        );
      } catch {}
    }
    return;
  }

  // /grantpet
  if (i.commandName === 'grantpet') {
    // FIRST: acknowledge (so Discord doesn't expire the token)
    if (!i.replied && !i.deferred) {
      await i.deferReply({ ephemeral: true });
    }

    // THEN: permission check
    if (!isOwner(i.user.id)) {
      await i.editReply('This command is owner-only.');
      return;
    }

    try {
      const targetDiscordUser = i.options.getUser('discorduser', false);
      const robloxUsernameArg = i.options.getString('roblox_username', false)?.trim();
      const petIdArg = i.options.getInteger('petid', false);
      const amountArg = i.options.getInteger('amount', false);
      const rarityArg = normRarity(i.options.getString('rarity', false) || DEFAULT_RARITY);
      const reason = i.options.getString('reason', false) || null;

      const petId = Number(petIdArg ?? DEFAULT_PET_ID) || 109999;
      const amount = Number(amountArg ?? DEFAULT_AMOUNT) || 1;

      let robloxUsername = null;
      let robloxUserId = null;
      let resolvedVia = null;

      if (robloxUsernameArg) {
        robloxUsername = robloxUsernameArg;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'roblox_username';
      } else if (targetDiscordUser) {
        const links = loadMap();
        const linked = links[targetDiscordUser.id];
        if (!linked) {
          await i.editReply(
            `Selected Discord user <@${targetDiscordUser.id}> is not linked.\nEither have them run /link or pass roblox_username directly.`
          );
          return;
        }
        robloxUsername = linked;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'discord_link';
      } else {
        await i.editReply('You must provide either roblox_username or discorduser.');
        return;
      }

      if (!robloxUserId) {
        await i.editReply(
          `I couldn’t find Roblox user **${robloxUsername}**. Double-check the username or try again.`
        );
        return;
      }

      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost_admin',
          performedBy: i.user.id,
          targetDiscordId: targetDiscordUser?.id ?? null,
          robloxUsername,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount, rarity: rarityArg },
          reason: reason || "You’ve received a special admin reward!",
          meta: { resolvedVia },
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver:', e.message);
      }

      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId,
          amount,
          rarity: rarityArg,
          reason: reason || "You’ve received a special admin reward!",
          admin: true,
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }

      await i.editReply(
        [
          '✅ **Grant queued**',
          `• Roblox: **${robloxUsername}** (ID: ${robloxUserId})`,
          targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
          `• Reward: Pet ${petId} × ${amount}`,
          `• Rarity: ${rarityArg}`,
          reason ? `• Reason: ${reason}` : null,
          `• Via: ${resolvedVia}`,
          '• Delivery: instant if online; otherwise on next join',
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (e) {
      console.error('grantpet error:', e);
      try {
        await i.editReply('Failed to process grant. Check bot console for details.');
      } catch {}
    }
    return;
  }

  // NEW: /resetdata
  if (i.commandName === 'resetdata') {
    if (!i.replied && !i.deferred) {
      await i.deferReply({ ephemeral: true });
    }

    // Owner-only
    if (!isOwner(i.user.id)) {
      await i.editReply('This command is owner-only.');
      return;
    }

    try {
      const targetDiscordUser = i.options.getUser('discorduser', false);
      const robloxUsernameArg = i.options.getString('roblox_username', false)?.trim();
      const reason = i.options.getString('reason', false) || 'Admin requested reset';

      let robloxUsername = null;
      let robloxUserId = null;
      let resolvedVia = null;

      if (robloxUsernameArg) {
        robloxUsername = robloxUsernameArg;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'roblox_username';
      } else if (targetDiscordUser) {
        const links = loadMap();
        const linked = loadMap()[targetDiscordUser.id];
        if (!linked) {
          await i.editReply(
            `Selected Discord user <@${targetDiscordUser.id}> is not linked.\nEither have them run /link or pass roblox_username directly.`
          );
          return;
        }
        robloxUsername = linked;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'discord_link';
      } else {
        await i.editReply('You must provide either roblox_username or discorduser.');
        return;
      }

      if (!robloxUserId) {
        await i.editReply(
          `I couldn’t find Roblox user **${robloxUsername}**. Double-check the username or try again.`
        );
        return;
      }

      // Try instant via MessagingService
      try {
        await publishToRoblox(TOPIC, {
          type: 'reset_data_admin',
          action: 'reset_data',
          performedBy: i.user.id,
          targetDiscordId: targetDiscordUser?.id ?? null,
          robloxUsername,
          robloxUserId,
          reason,
          meta: { resolvedVia },
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver reset:', e.message);
      }

      // Always queue as a fallback for offline
      try {
        await enqueueViaOpenCloud(robloxUserId, {
          action: 'reset_data',
          reason,
          admin: true,
        });
      } catch (e) {
        console.error('Queue (DataStore) failed (reset):', e);
      }

      await i.editReply(
        [
          '🧹 **Reset queued**',
          `• Roblox: **${robloxUsername}** (ID: ${robloxUserId})`,
          targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
          `• Reason: ${reason}`,
          `• Via: ${resolvedVia}`,
          '• Delivery: instant if online; otherwise on next join',
        ]
        .filter(Boolean)
        .join('\n')
      );
    } catch (e) {
      console.error('resetdata error:', e);
      try {
        await i.editReply('Failed to process reset. Check bot console for details.');
      } catch {}
    }
    return;
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== GUILD_ID) return;
    const before = oldMember?.premiumSince;
    const after = newMember?.premiumSince;

    if (!before && after) {
      const links = loadMap();
      const discordId = newMember.id;
      const username = links[discordId];

      if (!username) {
        await newMember
          .send('Thanks for boosting! Run /link <roblox_username> so I can send your in-game pet.')
          .catch(() => {});
        return;
      }

      const robloxUserId = await robloxUserIdFromUsername(username);
      if (!robloxUserId) {
        await newMember
          .send(
            `I couldn’t find Roblox user **${username}**. Please re-run /link with the correct name.`
          )
          .catch(() => {});
        return;
      }

      const petId = Number(DEFAULT_PET_ID) || 109999;
      const amount = Number(DEFAULT_AMOUNT) || 1;
      const rarity = normRarity(DEFAULT_RARITY);

      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost',
          discordId,
          robloxUsername: username,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount, rarity },
          reason: "Thanks for boosting the server! Your reward has been delivered.",
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver:', e.message);
      }

      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId,
          amount,
          rarity,
          reason: "Thanks for boosting the server! Your reward has been delivered.",
          admin: false
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }

      await newMember
        .send(
          `✨ Thanks for boosting! Your in-game reward (Pet ID **${petId}**, rarity **${rarity}**) is queued. Join the game to receive it!`
        )
        .catch(() => {});

      console.log(`Queued reward for Discord ${discordId} -> Roblox ${robloxUserId} (${rarity})`);
    }
  } catch (err) {
    console.error('Boost handler error:', err);
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await registerCommands(c.user.id);
  } catch (e) {
    console.error('Command register failed:', e);
  }
});

process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('UncaughtException:', e));

client.login(DISCORD_TOKEN);
