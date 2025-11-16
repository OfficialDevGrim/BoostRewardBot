// index.js — Discord → Roblox Boost Reward Bot (Node 18+ / 22+)
// /claimboost removed completely.

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

const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

// --- tiny HTTP server ---
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
  DEFAULT_RARITY = 'normal',
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
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel,
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

// ---------- Open Cloud: MessagingService ----------
async function publishToRoblox(topic, payload) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/${encodeURIComponent(topic)}`;

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
}

// ---------- Open Cloud: DataStore Queue ----------
async function ocGetQueue(userId) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;

  const res = await fetch(u, {
    headers: { 'x-api-key': ROBLOX_API_KEY },
  });

  if (res.status === 404) {
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
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;

  const headers = {
    'x-api-key': ROBLOX_API_KEY,
    'Content-Type': 'application/json',
  };
  if (etag) headers['If-Match'] = etag;

  const res = await fetch(u, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error(`OC Put DS failed ${res.status}: ${await res.text()}`);

  return true;
}

async function enqueueViaOpenCloud(robloxUserId, item, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { body, etag } = await ocGetQueue(robloxUserId);
    body.items = Array.isArray(body.items) ? body.items : [];
    body.items.push(item);
    const ok = await ocPutQueue(robloxUserId, body, etag);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200 + 150 * attempt));
  }
  throw new Error('enqueueViaOpenCloud failed after retries');
}

// --- Slash Commands (NO claimboost!!!) ---
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
    .addStringOption(o =>
      o.setName('username').setDescription('Your Roblox username').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('grantpet')
    .setDescription('[OWNER] Grant a boost reward to anyone, anytime.')
    .addUserOption((o) =>
      o.setName('discorduser').setDescription('Discord user (uses their linked Roblox name if set).')
    )
    .addStringOption((o) =>
      o.setName('roblox_username').setDescription('Roblox username if not using discorduser.')
    )
    .addIntegerOption((o) =>
      o.setName('petid').setDescription('Optional override pet ID.')
    )
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount to grant.')
    )
    .addStringOption((o) => {
      o.setName('rarity').setDescription('normal | golden | rainbow | darkmatter | shiny | all');
      rarityChoices.forEach(([name,value]) => o.addChoices({ name, value }));
      return o;
    })
    .addStringOption((o) =>
      o.setName('reason').setDescription('Optional reason.')
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resetdata')
    .setDescription('[OWNER] Reset a player’s saved data (online OR offline).')
    .addUserOption((o) =>
      o.setName('discorduser').setDescription('Discord user (uses linked Roblox username).')
    )
    .addStringOption((o) =>
      o.setName('roblox_username').setDescription('Roblox username to reset.')
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Optional reason.')
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
async function registerCommands(appId) {
  await rest.put(
    Routes.applicationGuildCommands(appId, GUILD_ID),
    { body: commands },
  );
  console.log('Guild slash commands registered.');

  await rest.put(
    Routes.applicationCommands(appId),
    { body: commands },
  );
  console.log('Global slash commands registered.');
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

  // /grantpet (owner-only)
  if (i.commandName === 'grantpet') {
    if (!i.replied && !i.deferred) {
      await i.deferReply({ ephemeral: true });
    }

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
        await i.editReply(`I couldn’t find Roblox user **${robloxUsername}**.`);
        return;
      }

      // Instant attempt
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
        console.warn('Publish failed; queue fallback:', e.message);
      }

      // Always queue
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
          '• Delivery: instant if online; otherwise next join',
        ]
        .filter(Boolean)
        .join('\n')
      );
    } catch (e) {
      console.error('grantpet error:', e);
      try { await i.editReply('Grant error.'); } catch {}
    }
    return;
  }

  // /resetdata (owner-only)
  if (i.commandName === 'resetdata') {
    if (!i.replied && !i.deferred) {
      await i.deferReply({ ephemeral: true });
    }

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
        const linked = links[targetDiscordUser.id];
        if (!linked) {
          await i.editReply(
            `Selected Discord user <@${targetDiscordUser.id}> is not linked.\nEither have them /link or pass roblox_username directly.`
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
        await i.editReply(`Invalid Roblox username **${robloxUsername}**.`);
        return;
      }

      // Real-time attempt
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
        console.warn('Publish failed; queue fallback:', e.message);
      }

      // Always queue
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
          `• Roblox: **${robloxUsername}** (${robloxUserId})`,
          targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
          `• Reason: ${reason}`,
          `• Via: ${resolvedVia}`,
          '• Delivery: instant if online; otherwise next join',
        ]
        .filter(Boolean)
        .join('\n')
      );
    } catch (e) {
      console.error('resetdata error:', e);
      try { await i.editReply('Reset error.'); } catch {}
    }
    return;
  }
});

// Booster auto-detect (unchanged)
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
          .send('Thanks for boosting! Run /link <roblox_username> to receive your pet.')
          .catch(() => {});
        return;
      }

      const robloxUserId = await robloxUserIdFromUsername(username);
      if (!robloxUserId) {
        await newMember.send(`Roblox name **${username}** not found. Re-run /link.`).catch(()=>{});
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
          reason: "Thanks for boosting!",
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed (booster auto):', e.message);
      }

      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId,
          amount,
          rarity,
          reason: "Thanks for boosting!",
          admin: false
        });
      } catch (e) {
        console.error('Queue failed:', e);
      }

      await newMember.send(
        `✨ Thanks for boosting! Your in-game pet (ID **${petId}**) is queued.`
      ).catch(()=>{});
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
