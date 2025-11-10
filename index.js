// Boost Reward Bot — Discord → Roblox
// Works with pet ID or pet name. Offline queue writes match Roblox server format.

require('dotenv').config();

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

const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

// --- keep-alive for hosting ---
const keepAliveApp = express();
keepAliveApp.get('/', (_, res) => res.send('BoostRewardBot alive'));
keepAliveApp.listen(process.env.PORT || 3000);

// --- env ---
const {
  DISCORD_TOKEN,
  GUILD_ID,
  ROBLOX_UNIVERSE_ID,
  ROBLOX_API_KEY,
  TOPIC = 'DiscordBoost',
  OWNER_IDS = '',
  DEFAULT_PET_ID = '5000000',
  DEFAULT_AMOUNT = '1',
  DEFAULT_RARITY = 'normal',
  DATA_DIR = './data',
  DS_NAME = 'DiscordBoostQueue_v1',
  GRANT_WEBHOOK_URL = '', // optional: if you want the bot to log grants too
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !ROBLOX_UNIVERSE_ID || !ROBLOX_API_KEY) {
  console.error('Missing required env vars.');
  process.exit(1);
}

const OWNER_SET = new Set(
  OWNER_IDS.split(',').map(s => s.trim()).filter(Boolean)
);

// ---- link map ----
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAP_FILE = path.join(DATA_DIR, 'links.json');

function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); }
  catch { return {}; }
}
function saveMap(m) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2));
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

// ---- helpers ----
function normRarity(s) {
  if (!s) return 'normal';
  s = String(s).toLowerCase();
  const map = {
    normal:'normal', default:'normal', none:'normal',
    gold:'golden', golden:'golden', g:'golden',
    rb:'rainbow', rainbow:'rainbow', r:'rainbow',
    dm:'darkmatter', dark:'darkmatter', darkmatter:'darkmatter',
    shiny:'shiny', sh:'shiny',
    all:'all'
  };
  return map[s] || 'normal';
}
function isOwner(id) { return OWNER_SET.has(id); }

async function robloxUserIdFromUsername(username) {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ usernames:[username], excludeBannedUsers:false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = data?.data?.[0];
  return user?.id ?? null;
}

// ---------- Open Cloud: MessagingService ----------
async function publishToRoblox(topic, payload) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/${encodeURIComponent(topic)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': ROBLOX_API_KEY, 'Content-Type':'application/json' },
    body: JSON.stringify({ message: JSON.stringify(payload) }),
  });
  if (!res.ok) throw new Error(`OpenCloud publish ${res.status}`);
}

// ---------- Open Cloud: Standard DataStores (append to {items:[]}) ----------
async function ocGetQueue(userId) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;
  const res = await fetch(u, { headers: { 'x-api-key': ROBLOX_API_KEY } });
  if (res.status === 404) return { body:{ items: [] }, etag: null };
  if (!res.ok) throw new Error(`OC get ${res.status}: ${await res.text()}`);
  const etag = res.headers.get('etag');
  let body = {};
  try { body = await res.json(); } catch {}
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) body = { items: [] };
  return { body, etag };
}
async function ocPutQueue(userId, body, etag) {
  const base = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;
  const u = `${base}?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;
  const headers = { 'x-api-key': ROBLOX_API_KEY, 'Content-Type':'application/json' };
  if (etag) headers['If-Match'] = etag;
  const res = await fetch(u, { method:'PUT', headers, body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 412) return false; // retry
  if (!res.ok) throw new Error(`OC put ${res.status}: ${await res.text()}`);
  return true;
}
async function enqueueViaOpenCloud(robloxUserId, item, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { body, etag } = await ocGetQueue(robloxUserId);
    body.items = Array.isArray(body.items) ? body.items : [];
    body.items.push(item);
    const ok = await ocPutQueue(robloxUserId, body, etag);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 200 + 200 * attempt));
  }
  throw new Error('enqueueViaOpenCloud failed');
}

// ---------- slash commands ----------
const rarityChoices = [
  ['normal','normal'],['golden','golden'],['rainbow','rainbow'],['darkmatter','darkmatter'],['shiny','shiny'],['all','all'],
];

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Roblox username to your Discord user.')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink your Roblox username.')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('claimboost')
    .setDescription('Manually claim your booster pet (if you’re boosting).')
    .addStringOption(o => {
      o.setName('rarity').setDescription('normal|golden|rainbow|darkmatter|shiny|all').setRequired(false);
      rarityChoices.forEach(([name, value]) => o.addChoices({ name, value }));
      return o;
    })
    .toJSON(),

  new SlashCommandBuilder()
    .setName('grantpet')
    .setDescription('[OWNER] Grant a pet by Discord user or Roblox username.')
    .addUserOption(o => o.setName('discorduser').setDescription('Discord user').setRequired(false))
    .addStringOption(o => o.setName('roblox_username').setDescription('Roblox username (if not using discorduser)').setRequired(false))
    .addIntegerOption(o => o.setName('petid').setDescription('Pet ID (ignored if petname provided)').setRequired(false))
    .addStringOption(o => o.setName('petname').setDescription('Pet name (takes precedence over petid)').setRequired(false))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount (default from env)').setRequired(false))
    .addStringOption(o => {
      o.setName('rarity').setDescription('normal|golden|rainbow|darkmatter|shiny|all').setRequired(false);
      rarityChoices.forEach(([name, value]) => o.addChoices({ name, value }));
      return o;
    })
    .addStringOption(o => o.setName('reason').setDescription('Reason (optional)').setRequired(false))
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(
      Routes.applicationGuildCommands(app.id, GUILD_ID),
      { body: commands }
    );
    await rest.put(
      Routes.applicationCommands(app.id),
      { body: commands }
    );
    console.log('Slash commands registered.');
  } catch (e) {
    console.error('Command register failed:', e);
  }
});


// ---------- interactions ----------
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === 'link') {
    const username = i.options.getString('username', true).trim();
    await i.deferReply({ flags: 64 });
    const id = await robloxUserIdFromUsername(username);
    if (!id) return i.editReply(`❌ Could not find Roblox user **${username}**.`);
    const links = loadMap(); links[i.user.id] = username; saveMap(links);
    return i.editReply(`✅ Linked to **${username}** (ID: ${id}).`);
  }

  if (i.commandName === 'unlink') {
    await i.deferReply({ flags: 64 });
    const links = loadMap();
    if (!links[i.user.id]) return i.editReply('You are not linked.');
    delete links[i.user.id]; saveMap(links);
    return i.editReply('✅ Unlinked.');
  }

  if (i.commandName === 'claimboost') {
    await i.deferReply({ flags: 64 });
    const links = loadMap();
    const username = links[i.user.id];
    if (!username) return i.editReply('You are not linked. Run `/link <roblox_username>` first.');
    const robloxUserId = await robloxUserIdFromUsername(username);
    if (!robloxUserId) return i.editReply(`Couldn’t find Roblox user **${username}**.`);
    const petId = Number(DEFAULT_PET_ID) || 5000000;
    const amount = Number(DEFAULT_AMOUNT) || 1;
    const rarityOpt = normRarity(i.options.getString('rarity', false) || DEFAULT_RARITY);

    try {
      await publishToRoblox(TOPIC, {
        type: 'discord_boost',
        discordId: i.user.id,
        robloxUsername: username,
        robloxUserId,
        reward: { kind: 'pet', id: petId, amount, rarity: rarityOpt },
        reason: 'Thanks for boosting!',
        ts: Date.now(),
      });
    } catch {}

    try {
      await enqueueViaOpenCloud(robloxUserId, {
        petId,
        amount,
        rarity: rarityOpt,
        reason: 'Thanks for boosting!',
        admin: false,
        discordId: i.user.id,
        discordTag: i.user.username,
      });
    } catch {}

    return i.editReply('✅ Claim queued. If the game is online it’s instant; otherwise you’ll get it when you join.');
  }

  if (i.commandName === 'grantpet') {
    if (!isOwner(i.user.id)) return i.reply({ content: 'This command is owner-only.', flags: 64 });

    if (!i.deferred && !i.replied) await i.deferReply({ flags: 64 });

    try {
      const targetDiscordUser = i.options.getUser('discorduser', false);
      const robloxUsernameArg = i.options.getString('roblox_username', false)?.trim();
      const petIdArg = i.options.getInteger('petid', false);
      const petNameArg = i.options.getString('petname', false)?.trim();
      const amountArg = i.options.getInteger('amount', false);
      const rarityArg = normRarity(i.options.getString('rarity', false) || DEFAULT_RARITY);
      const reason = i.options.getString('reason', false) || "You’ve received a special admin reward!";

      const petId = Number(petIdArg ?? DEFAULT_PET_ID) || 5000000;
      const amount = Number(amountArg ?? DEFAULT_AMOUNT) || 1;

      let robloxUsername, robloxUserId, resolvedVia;

      if (robloxUsernameArg) {
        robloxUsername = robloxUsernameArg;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'roblox_username';
      } else if (targetDiscordUser) {
        const links = loadMap();
        const linked = links[targetDiscordUser.id];
        if (!linked) return i.editReply(`User <@${targetDiscordUser.id}> is not linked.`);
        robloxUsername = linked;
        robloxUserId = await robloxUserIdFromUsername(robloxUsername);
        resolvedVia = 'discord_link';
      } else {
        return i.editReply('Provide either `roblox_username` or `discorduser`.');
      }

      if (!robloxUserId) return i.editReply(`Couldn’t find Roblox user **${robloxUsername}**.`);

      const payloadReward = petNameArg
        ? { kind: 'pet', name: petNameArg, amount, rarity: rarityArg }
        : { kind: 'pet', id: petId, amount, rarity: rarityArg };

      try {
        await publishToRoblox(TOPIC, {
          type: 'discord_boost_admin',
          performedBy: i.user.id,
          discordTag: i.user.username,
          targetDiscordId: targetDiscordUser?.id ?? null,
          robloxUsername,
          robloxUserId,
          reward: payloadReward,
          reason,
          meta: { resolvedVia },
          ts: Date.now(),
        });
      } catch {}

      const queueItem = {
        amount,
        rarity: rarityArg,
        reason,
        admin: true,
        discordId: i.user.id,
        discordTag: i.user.username,
      };
      if (payloadReward.name) queueItem.petName = payloadReward.name;
      else queueItem.petId = payloadReward.id;

      try {
        await enqueueViaOpenCloud(robloxUserId, queueItem);
      } catch {}

      if (GRANT_WEBHOOK_URL) {
        const embed = {
          title: '🎁 Pet Granted',
          color: 5793266,
          fields: [
            { name: 'Reward', value: payloadReward.name ? payloadReward.name : `Pet ${petId}`, inline: true },
            { name: 'Amount', value: String(amount), inline: true },
            { name: 'Rarity', value: rarityArg, inline: true },
            { name: 'Roblox', value: `**${robloxUsername}** (ID: ${robloxUserId})`, inline: false },
            targetDiscordUser ? { name: 'Discord', value: `<@${targetDiscordUser.id}>`, inline: false } : null,
          ].filter(Boolean),
        };
        fetch(GRANT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ username: 'Boost Reward Bot', embeds: [embed] }),
        }).catch(() => {});
      }

      return i.editReply(
        [
          '✅ **Grant queued**',
          `• Roblox: **${robloxUsername}** (ID: ${robloxUserId})`,
          targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
          `• Reward: ${payloadReward.name ? payloadReward.name : `Pet ${petId}`} × ${amount}`,
          `• Rarity: ${rarityArg}`,
          reason ? `• Reason: ${reason}` : null,
          `• Via: ${resolvedVia}`,
          '• Delivery: instant if online; otherwise on next join',
        ].filter(Boolean).join('\n')
      );
    } catch (e) {
      console.error('grantpet error:', e);
      return i.editReply('Failed to process grant. Check bot logs.');
    }
  }
});

// ---------- ready ----------
client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});
client.login(DISCORD_TOKEN);
