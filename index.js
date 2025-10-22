// index.js — Discord → Roblox Boost Reward Bot (Node 18+ / 22+)
require('dotenv').config();
const fs = require('fs');
<<<<<<< HEAD
<<<<<<< HEAD
const path = require('path');
=======
>>>>>>> 9154d50 (first deploy)
=======
const path = require('path');
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
<<<<<<< HEAD
<<<<<<< HEAD
} = require('discord.js');

// --- Env ---
=======
  MessageFlags,
} = require('discord.js');

>>>>>>> 9154d50 (first deploy)
=======
} = require('discord.js');

// --- Env ---
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROBLOX_UNIVERSE_ID,
  ROBLOX_API_KEY,
  TOPIC = 'DiscordBoost',
  OWNER_IDS = '',
  DEFAULT_PET_ID = '5000000',
  DEFAULT_AMOUNT = '1',
<<<<<<< HEAD
<<<<<<< HEAD
  DATA_DIR = './data',
  DS_NAME = 'DiscordBoostQueue_v1', // DataStore used by your Roblox server script
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !ROBLOX_UNIVERSE_ID || !ROBLOX_API_KEY) {
  console.error('Missing required env vars. Check .env (DISCORD_TOKEN, GUILD_ID, ROBLOX_UNIVERSE_ID, ROBLOX_API_KEY).');
  process.exit(1);
}

const OWNER_SET = new Set(
  OWNER_IDS.split(',').map(s => s.trim()).filter(Boolean)
);

// --- Simple JSON map for DiscordID -> RobloxUsername ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAP_FILE = path.join(DATA_DIR, 'links.json');
function loadMap() { try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch { return {}; } }
function saveMap(m) { fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2)); }

// --- Client ---
=======
=======
  DATA_DIR = './data',
  DS_NAME = 'DiscordBoostQueue_v1', // DataStore used by your Roblox server script
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !ROBLOX_UNIVERSE_ID || !ROBLOX_API_KEY) {
  console.error('Missing required env vars. Check .env (DISCORD_TOKEN, GUILD_ID, ROBLOX_UNIVERSE_ID, ROBLOX_API_KEY).');
  process.exit(1);
}

const OWNER_SET = new Set(
  OWNER_IDS.split(',').map(s => s.trim()).filter(Boolean)
);

// --- Simple JSON map for DiscordID -> RobloxUsername ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAP_FILE = path.join(DATA_DIR, 'links.json');
function loadMap() { try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch { return {}; } }
function saveMap(m) { fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2)); }

<<<<<<< HEAD
>>>>>>> 9154d50 (first deploy)
=======
// --- Client ---
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

<<<<<<< HEAD
<<<<<<< HEAD
// --- Slash Commands ---
=======
>>>>>>> 9154d50 (first deploy)
=======
// --- Slash Commands ---
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Roblox username so boosts reward you in-game.')
    .addStringOption(o =>
      o.setName('username').setDescription('Your Roblox username').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('claimboost')
    .setDescription('Manually claim the booster pet if you were already boosting.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('grantpet')
    .setDescription('[OWNER] Grant a boost reward to anyone, anytime.')
    .addUserOption(o =>
      o.setName('discorduser')
       .setDescription('Discord user to grant (uses their linked Roblox username if set).')
       .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('roblox_username')
       .setDescription('Roblox username to grant directly (if not using discorduser).')
       .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('petid')
       .setDescription('Override pet ID for this grant (default from env).')
       .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName('amount')
       .setDescription('Amount to grant (default from env).')
       .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('reason')
       .setDescription('Optional reason/note for this grant.')
       .setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
async function registerCommands(appId) {
  await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
  console.log('Slash commands registered: /link, /claimboost, /grantpet');
}

function isOwner(discordUserId) {
  return OWNER_SET.has(discordUserId);
}

async function isServerBooster(i) {
  if (!i.inGuild()) return false;
  let member = i.member;
  if (!member || !member.premiumSince) {
    try { member = await i.guild.members.fetch(i.user.id); } catch {}
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

<<<<<<< HEAD
<<<<<<< HEAD
// ---------- Open Cloud: MessagingService (instant) ----------
=======
>>>>>>> 9154d50 (first deploy)
=======
// ---------- Open Cloud: MessagingService (instant) ----------
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
async function publishToRoblox(topic, payload) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/${encodeURIComponent(topic)}`;
  console.log('Publishing to Roblox:', {
    universe: ROBLOX_UNIVERSE_ID,
    topic,
    robloxUserId: payload.robloxUserId,
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

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
// ---------- Open Cloud: DataStore (offline queue) ----------
async function ocGetQueue(userId) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&entryKey=${encodeURIComponent(String(userId))}`;
  const res = await fetch(u, { headers: { 'x-api-key': ROBLOX_API_KEY } });
  if (res.status === 404) return { body: { items: [] }, etag: null };
  if (!res.ok) throw new Error(`OC Get DS failed ${res.status}: ${await res.text()}`);
  const etag = res.headers.get('etag');
  let body = {};
  try { body = await res.json(); } catch {}
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) body = { items: [] };
  return { body, etag };
}

async function ocPutQueue(userId, body, etag) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&entryKey=${encodeURIComponent(String(userId))}`;
  const headers = { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag; // optimistic concurrency
  const res = await fetch(u, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 412) return false; // ETag mismatch – caller will retry
  if (!res.ok) throw new Error(`OC Put DS failed ${res.status}: ${await res.text()}`);
  return true;
}

async function enqueueViaOpenCloud(robloxUserId, item, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { body, etag } = await ocGetQueue(robloxUserId);
    body.items = Array.isArray(body.items) ? body.items : [];
    body.items.push(item);
    const ok = await ocPutQueue(robloxUserId, body, etag);
    if (ok) { console.log('Queued via DataStore for', robloxUserId, item); return true; }
    await new Promise(r => setTimeout(r, 200 + 150 * attempt));
  }
  throw new Error('enqueueViaOpenCloud failed after retries');
}

// --- Interaction handler ---
<<<<<<< HEAD
=======
>>>>>>> 9154d50 (first deploy)
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === 'link') {
    const username = i.options.getString('username', true).trim();
    const links = loadMap();
    links[i.user.id] = username;
    saveMap(links);
    await i.reply({
<<<<<<< HEAD
      content: `Linked ✅ **${username}**. When you boost, I’ll send your in-game pet.`,
<<<<<<< HEAD
      ephemeral: true
=======
      flags: MessageFlags.Ephemeral
>>>>>>> 9154d50 (first deploy)
=======
      content: `Linked ✅ **${username}**.`,
      ephemeral: true
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
    });
    return;
  }

  if (i.commandName === 'claimboost') {
    try {
      if (!(await isServerBooster(i))) {
        await i.reply({
          content: 'This command is only for **current server boosters**. Boost the server, then run `/claimboost`.',
<<<<<<< HEAD
<<<<<<< HEAD
          ephemeral: true
=======
          flags: MessageFlags.Ephemeral,
>>>>>>> 9154d50 (first deploy)
=======
          ephemeral: true
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
        });
        return;
      }

<<<<<<< HEAD
<<<<<<< HEAD
      await i.deferReply({ ephemeral: true });
=======
      await i.deferReply({ flags: MessageFlags.Ephemeral });
>>>>>>> 9154d50 (first deploy)
=======
      await i.deferReply({ ephemeral: true });
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))

      const links = loadMap();
      const username = links[i.user.id];
      if (!username) {
        await i.editReply('You are not linked yet. Run `/link <roblox_username>` first.');
        return;
      }

      const robloxUserId = await robloxUserIdFromUsername(username);
      if (!robloxUserId) {
        await i.editReply(`I couldn’t find Roblox user **${username}**. Re-run /link with the correct name.`);
        return;
      }

      const petId = Number(DEFAULT_PET_ID) || 5000000;
      const amount = Number(DEFAULT_AMOUNT) || 1;

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
      // Instant path (if a server is online)
      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost',
          discordId: i.user.id,
          robloxUsername: username,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount },
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver:', e.message);
      }
<<<<<<< HEAD

      // Offline guarantee path
      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId, amount, reason: null, admin: false
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }

      await i.editReply('Claim queued ✅ If a server was online it’s instant; otherwise you’ll get it next time you join.');
    } catch (e) {
      console.error('claimboost error:', e);
      try { await i.editReply('Failed to process claim. Check bot console for details.'); } catch {}
=======
      await publishToRoblox(TOPIC, {
        type: 'discord_boost',
        discordId: i.user.id,
        robloxUsername: username,
        robloxUserId,
        reward: { kind: 'pet', id: petId, amount },
        ts: Date.now(),
      });
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))

      // Offline guarantee path
      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId, amount, reason: null, admin: false
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }

      await i.editReply('Claim queued ✅ If a server was online it’s instant; otherwise you’ll get it next time you join.');
    } catch (e) {
      console.error('claimboost error:', e);
<<<<<<< HEAD
      try { await i.editReply('Failed to publish to Roblox. Check bot console for details.'); } catch {}
>>>>>>> 9154d50 (first deploy)
=======
      try { await i.editReply('Failed to process claim. Check bot console for details.'); } catch {}
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
    }
    return;
  }

  if (i.commandName === 'grantpet') {
    if (!isOwner(i.user.id)) {
<<<<<<< HEAD
<<<<<<< HEAD
      await i.reply({ content: 'This command is owner-only.', ephemeral: true });
=======
      await i.reply({ content: 'This command is owner-only.', flags: MessageFlags.Ephemeral });
>>>>>>> 9154d50 (first deploy)
=======
      await i.reply({ content: 'This command is owner-only.', ephemeral: true });
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
      return;
    }

    try {
<<<<<<< HEAD
<<<<<<< HEAD
      await i.deferReply({ ephemeral: true });
=======
      await i.deferReply({ flags: MessageFlags.Ephemeral });
>>>>>>> 9154d50 (first deploy)
=======
      await i.deferReply({ ephemeral: true });
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))

      const targetDiscordUser = i.options.getUser('discorduser', false);
      const robloxUsernameArg = i.options.getString('roblox_username', false)?.trim();
      const petIdArg = i.options.getInteger('petid', false);
      const amountArg = i.options.getInteger('amount', false);
      const reason = i.options.getString('reason', false) || null;

      const petId = Number(petIdArg ?? DEFAULT_PET_ID) || 5000000;
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
          await i.editReply(`Selected Discord user <@${targetDiscordUser.id}> is not linked.\nEither have them run \`/link\` or pass \`roblox_username\` directly.`);
          return;
        }
        robloxUsername = linked;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'discord_link';
      } else {
        await i.editReply('You must provide either `roblox_username` or `discorduser`.');
        return;
      }

      if (!robloxUserId) {
        await i.editReply(`I couldn’t find Roblox user **${robloxUsername}**. Double-check the username or try again.`);
        return;
      }

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
      // Instant path
      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost_admin',
          performedBy: i.user.id,
          targetDiscordId: targetDiscordUser?.id ?? null,
          robloxUsername,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount },
          reason,
          meta: { resolvedVia },
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver:', e.message);
      }

      // Offline guarantee path
      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId, amount, reason: reason || null, admin: true
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }
<<<<<<< HEAD
=======
      await publishToRoblox(TOPIC, {
        type: 'discord_boost_admin',
        performedBy: i.user.id,
        targetDiscordId: targetDiscordUser?.id ?? null,
        robloxUsername,
        robloxUserId,
        reward: { kind: 'pet', id: petId, amount },
        reason,
        meta: { resolvedVia },
        ts: Date.now(),
      });
>>>>>>> 9154d50 (first deploy)
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))

      await i.editReply([
        '✅ **Grant queued**',
        `• Roblox: **${robloxUsername}** (ID: \`${robloxUserId}\`)`,
        targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
        `• Reward: Pet \`${petId}\` × \`${amount}\``,
        reason ? `• Reason: ${reason}` : null,
        `• Via: ${resolvedVia}`,
<<<<<<< HEAD
<<<<<<< HEAD
        `• Delivery: instant if online; otherwise on next join`,
      ].filter(Boolean).join('\n'));
    } catch (e) {
      console.error('grantpet error:', e);
      try { await i.editReply('Failed to process grant. Check bot console for details.'); } catch {}
=======
      ].filter(Boolean).join('\n'));
    } catch (e) {
      console.error('grantpet error:', e);
      try { await i.editReply('Failed to publish to Roblox. Check bot console for details.'); } catch {}
>>>>>>> 9154d50 (first deploy)
=======
        `• Delivery: instant if online; otherwise on next join`,
      ].filter(Boolean).join('\n'));
    } catch (e) {
      console.error('grantpet error:', e);
      try { await i.editReply('Failed to process grant. Check bot console for details.'); } catch {}
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
    }
    return;
  }
});

<<<<<<< HEAD
<<<<<<< HEAD
// --- Booster start/stop detector ---
=======
>>>>>>> 9154d50 (first deploy)
=======
// --- Booster start/stop detector ---
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== GUILD_ID) return;
    const before = oldMember?.premiumSince;
    const after  = newMember?.premiumSince;

<<<<<<< HEAD
<<<<<<< HEAD
    // Started boosting
=======
>>>>>>> 9154d50 (first deploy)
=======
    // Started boosting
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
    if (!before && after) {
      const links = loadMap();
      const discordId = newMember.id;
      const username = links[discordId];

      if (!username) {
        await newMember.send('Thanks for boosting! Run `/link <roblox_username>` so I can send your in-game pet.').catch(() => {});
        return;
      }

      const robloxUserId = await robloxUserIdFromUsername(username);
      if (!robloxUserId) {
        await newMember.send(`I couldn’t find Roblox user **${username}**. Please re-run /link with the correct name.`).catch(() => {});
        return;
      }

      const petId = Number(DEFAULT_PET_ID) || 5000000;
      const amount = Number(DEFAULT_AMOUNT) || 1;

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
      // Instant path
      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost',
          discordId,
          robloxUsername: username,
          robloxUserId,
          reward: { kind: 'pet', id: petId, amount },
          ts: Date.now(),
        });
      } catch (e) {
        console.warn('Publish failed; offline queue will still deliver:', e.message);
      }

      // Offline guarantee path
      try {
        await enqueueViaOpenCloud(robloxUserId, {
          petId, amount, reason: null, admin: false
        });
      } catch (e) {
        console.error('Queue (DataStore) failed:', e);
      }
<<<<<<< HEAD
=======
      await publishToRoblox(TOPIC, {
        type: 'discord_boost',
        discordId,
        robloxUsername: username,
        robloxUserId,
        reward: { kind: 'pet', id: petId, amount },
        ts: Date.now(),
      });
>>>>>>> 9154d50 (first deploy)
=======
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))

      await newMember.send(`✨ Thanks for boosting! Your in-game reward (Pet ID **${petId}**) is queued. Join the game to receive it!`).catch(() => {});
      console.log(`Queued reward for Discord ${discordId} -> Roblox ${robloxUserId}`);
    }
  } catch (err) {
    console.error('Boost handler error:', err);
  }
});

<<<<<<< HEAD
<<<<<<< HEAD
// --- Bootstrap ---
=======
>>>>>>> 9154d50 (first deploy)
=======
// --- Bootstrap ---
>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try { await registerCommands(c.user.id); } catch (e) { console.error('Command register failed:', e); }
});

<<<<<<< HEAD
<<<<<<< HEAD
process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('UncaughtException:', e));

=======
>>>>>>> 9154d50 (first deploy)
=======
process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('UncaughtException:', e));

>>>>>>> 2d6b94b (Update bot scripts (/link + other changes))
client.login(DISCORD_TOKEN);
