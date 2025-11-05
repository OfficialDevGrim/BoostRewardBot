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

const fetch = (...args) =>
  import('node-fetch').then((mod) => mod.default(...args));

/* ---------- Keep-alive ---------- */
const keepAliveApp = express();
keepAliveApp.get('/', (_, res) => res.send('BoostRewardBot alive'));
const PORT = process.env.PORT || 3000;
keepAliveApp.listen(PORT, () => console.log('Keep-alive web server running on port', PORT));

/* ---------- Env ---------- */
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
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !ROBLOX_UNIVERSE_ID || !ROBLOX_API_KEY) {
  console.error('Missing env vars: DISCORD_TOKEN, GUILD_ID, ROBLOX_UNIVERSE_ID, ROBLOX_API_KEY');
  process.exit(1);
}

console.log('BoostRewardBot loaded with topic:', TOPIC, 'Universe:', ROBLOX_UNIVERSE_ID);

const OWNER_SET = new Set(
  OWNER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
);

/* ---------- File setup ---------- */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MAP_FILE = path.join(DATA_DIR, 'links.json');

function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); }
  catch { return {}; }
}
function saveMap(m) { fs.writeFileSync(MAP_FILE, JSON.stringify(m, null, 2)); }

/* ---------- Discord client ---------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.GuildMember, Partials.Channel],
});

/* ---------- Helpers ---------- */
function normRarity(s) {
  if (!s) return 'normal';
  s = String(s).toLowerCase();
  const map = {
    normal: 'normal', none: 'normal', default: 'normal',
    gold: 'golden', golden: 'golden',
    rb: 'rainbow', rainbow: 'rainbow',
    dm: 'darkmatter', dark: 'darkmatter', darkmatter: 'darkmatter',
    shiny: 'shiny', all: 'all'
  };
  return map[s] || 'normal';
}

function isOwner(id) { return OWNER_SET.has(id); }

async function isServerBooster(i) {
  const guild = client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID).catch(() => null));
  if (!guild) return false;
  try {
    const member = await guild.members.fetch(i.user.id);
    return Boolean(member?.premiumSince);
  } catch { return false; }
}

async function robloxUserIdFromUsername(username) {
  const url = 'https://users.roblox.com/v1/usernames/users';
  const body = { usernames: [username], excludeBannedUsers: false };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0]?.id ?? null;
}

/* ---------- Roblox Open Cloud ---------- */
async function publishToRoblox(topic, payload) {
  const url = `https://apis.roblox.com/messaging-service/v1/universes/${ROBLOX_UNIVERSE_ID}/topics/${encodeURIComponent(topic)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: JSON.stringify(payload) })
  });
  if (!res.ok) throw new Error(`OpenCloud ${res.status}`);
}

async function ocGetQueue(userId) {
  const u = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;
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
  const u = `https://apis.roblox.com/datastores/v1/universes/${ROBLOX_UNIVERSE_ID}/standard-datastores/datastore/entries/entry?datastoreName=${encodeURIComponent(DS_NAME)}&scope=global&entryKey=${encodeURIComponent(String(userId))}`;
  const headers = { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag;
  const res = await fetch(u, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (res.status === 409 || res.status === 412) return false;
  if (!res.ok) throw new Error(`OC Put DS failed ${res.status}: ${await res.text()}`);
  return true;
}

async function enqueueViaOpenCloud(userId, item, retries = 3) {
  for (let a = 0; a < retries; a++) {
    const { body, etag } = await ocGetQueue(userId);
    body.items = Array.isArray(body.items) ? body.items : [];
    body.items.push(item);
    const ok = await ocPutQueue(userId, body, etag);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200 + 150 * a));
  }
  throw new Error('enqueueViaOpenCloud failed');
}

/* ---------- Commands ---------- */
const rarityChoices = [['normal','normal'],['golden','golden'],['rainbow','rainbow'],['darkmatter','darkmatter'],['shiny','shiny'],['all','all']];

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Roblox username so boosts reward you in-game.')
    .addStringOption(o=>o.setName('username').setDescription('Your Roblox username').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('claimboost')
    .setDescription('Manually claim the booster pet if you were already boosting.')
    .addStringOption(o=>{
      o.setName('rarity').setDescription('normal | golden | rainbow | darkmatter | shiny | all').setRequired(false);
      rarityChoices.forEach(([n,v])=>o.addChoices({name:n,value:v}));
      return o;
    }).toJSON(),

  new SlashCommandBuilder()
    .setName('grantpet')
    .setDescription('[OWNER] Grant a boost reward to anyone, anytime.')
    .addUserOption(o=>o.setName('discorduser').setDescription('Discord user to grant').setRequired(false))
    .addStringOption(o=>o.setName('roblox_username').setDescription('Roblox username').setRequired(false))
    .addIntegerOption(o=>o.setName('petid').setDescription('Pet ID').setRequired(false))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(false))
    .addStringOption(o=>{
      o.setName('rarity').setDescription('Rarity').setRequired(false);
      rarityChoices.forEach(([n,v])=>o.addChoices({name:n,value:v}));
      return o;
    })
    .addStringOption(o=>o.setName('reason').setDescription('Optional reason').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resetdata')
    .setDescription('[OWNER] Reset a player’s saved data (online OR offline).')
    .addUserOption(o=>o.setName('discorduser').setDescription('Discord user').setRequired(false))
    .addStringOption(o=>o.setName('roblox_username').setDescription('Roblox username').setRequired(false))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('grantcurrency')
    .setDescription('[OWNER] Grant a currency to a player.')
    .addUserOption(o=>o.setName('discorduser').setDescription('Discord user').setRequired(false))
    .addStringOption(o=>o.setName('roblox_username').setDescription('Roblox username').setRequired(false))
    .addStringOption(o=>o.setName('currency').setDescription('Currency name (e.g. Diamonds)').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Optional reason').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('[OWNER] Force re-register slash commands.')
    .toJSON(),
];

/* ---------- Command registration ---------- */
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands(appId) {
  try {
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
    console.log('Guild commands registered:', commands.map(c=>c.name).join(', '));

    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('Global commands registered.');
  } catch (e) {
    console.error('registerCommands error:', e);
  }
}

/* ---------- Interaction handler ---------- */
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  /* /sync */
  if (i.commandName === 'sync') {
    if (!isOwner(i.user.id)) {
      await i.reply({ content: 'Owner only.', flags: 64 });
      return;
    }
    await i.deferReply({ flags: 64 });
    try {
      await registerCommands(client.user.id);
      await i.editReply('Slash commands re-registered ✅');
    } catch {
      await i.editReply('Failed to re-register.');
    }
    return;
  }

  // existing /link, /claimboost, /grantpet, /resetdata, /grantcurrency handlers stay here (unchanged)
});

/* ---------- Startup ---------- */
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands(c.user.id);
});

process.on('unhandledRejection', (r) => console.error('UnhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('UncaughtException:', e));

client.login(DISCORD_TOKEN);
