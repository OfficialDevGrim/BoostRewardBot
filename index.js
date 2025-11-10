// Boost Reward Bot – by @DevGrim & @BrightBloxian
// Updated for Pet Name + ID support (works online & offline)

import {
	Client,
	GatewayIntentBits,
	Events,
	SlashCommandBuilder,
	Collection,
	REST,
	Routes,
} from "discord.js";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";

dotenv.config();

// ---------------- CONFIG ----------------
const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3001;

const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const TOPIC = "DiscordBoost";
const DEFAULT_PET_ID = 5000000;
const DEFAULT_AMOUNT = 1;
const DEFAULT_RARITY = "normal";
const OWNER_IDS = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(",") : [];

// Roblox Universe + Open Cloud
const API_KEY = process.env.API_KEY;
const UNIVERSE_ID = process.env.UNIVERSE_ID;

// JSON save file for linked Discord-Roblox accounts
const LINKS_FILE = "./links.json";

// Utility functions
function isOwner(id) {
	return OWNER_IDS.includes(id);
}

function loadMap() {
	try {
		return JSON.parse(fs.readFileSync(LINKS_FILE, "utf-8"));
	} catch {
		return {};
	}
}

function saveMap(map) {
	fs.writeFileSync(LINKS_FILE, JSON.stringify(map, null, 2));
}

async function robloxUserIdFromUsername(username) {
	const url = `https://users.roblox.com/v1/usernames/users`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ usernames: [username] }),
	});
	if (!res.ok) return null;
	const data = await res.json();
	return data.data && data.data[0] ? data.data[0].id : null;
}

async function publishToRoblox(topic, payload) {
	const url = `https://apis.roblox.com/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${topic}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": API_KEY,
		},
		body: JSON.stringify(payload),
	});
	if (!res.ok) throw new Error(`Failed to publish: ${res.status}`);
}

async function enqueueViaOpenCloud(userId, queueData) {
	const url = `https://apis.roblox.com/datastores/v1/universes/${UNIVERSE_ID}/standard-datastores/DiscordBoostQueue_v1/entries/${userId}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": API_KEY,
		},
		body: JSON.stringify({ value: { items: [queueData] } }),
	});
	if (!res.ok) throw new Error(`Queue failed: ${res.status}`);
}

function normRarity(r) {
	if (!r) return "normal";
	r = r.toLowerCase();
	if (["gold", "golden", "g"].includes(r)) return "g";
	if (["rainbow", "r"].includes(r)) return "r";
	if (["darkmatter", "dark", "dm", "d"].includes(r)) return "dm";
	if (["shiny", "sh", "s"].includes(r)) return "sh";
	if (["hc", "hardcore", "h"].includes(r)) return "hc";
	if (r === "all") return "all";
	return "normal";
}

// ---------------- DISCORD COMMANDS ----------------
const commands = [
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Roblox username with Discord.")
		.addStringOption(o =>
			o.setName("roblox_username").setDescription("Enter your Roblox username").setRequired(true)
		),
	new SlashCommandBuilder()
		.setName("unlink")
		.setDescription("Unlink your Roblox account."),
	new SlashCommandBuilder()
		.setName("claimboost")
		.setDescription("Claim your Discord server boost reward."),
	new SlashCommandBuilder()
		.setName("grantpet")
		.setDescription("Admin: Grant a pet reward.")
		.addUserOption(o =>
			o.setName("discorduser").setDescription("Target Discord user").setRequired(false)
		)
		.addStringOption(o =>
			o.setName("roblox_username").setDescription("Target Roblox username").setRequired(false)
		)
		.addIntegerOption(o =>
			o.setName("petid").setDescription("Pet ID to grant").setRequired(false)
		)
		.addStringOption(o =>
			o.setName("petname").setDescription("Pet name to grant").setRequired(false)
		)
		.addIntegerOption(o =>
			o.setName("amount").setDescription("How many pets").setRequired(false)
		)
		.addStringOption(o =>
			o.setName("rarity").setDescription("Rarity (normal, g, r, dm, sh, all)").setRequired(false)
		)
		.addStringOption(o =>
			o.setName("reason").setDescription("Reason for grant").setRequired(false)
		),
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
	body: commands.map(c => c.toJSON()),
});

// ---------------- COMMAND HANDLER ----------------
client.on(Events.InteractionCreate, async i => {
	if (!i.isChatInputCommand()) return;

	if (i.commandName === "link") {
		const username = i.options.getString("roblox_username", true);
		await i.deferReply({ flags: 64 });
		const userId = await robloxUserIdFromUsername(username);
		if (!userId) return i.editReply(`❌ Could not find Roblox user **${username}**.`);
		const map = loadMap();
		map[i.user.id] = username;
		saveMap(map);
		await i.editReply(`✅ Linked your Discord with Roblox account **${username}** (ID ${userId}).`);
		return;
	}

	if (i.commandName === "unlink") {
		await i.deferReply({ flags: 64 });
		const map = loadMap();
		if (!map[i.user.id]) return i.editReply("You are not linked.");
		delete map[i.user.id];
		saveMap(map);
		await i.editReply("✅ Unlinked your Roblox account.");
		return;
	}

	if (i.commandName === "claimboost") {
		await i.deferReply({ flags: 64 });
		const map = loadMap();
		const username = map[i.user.id];
		if (!username) return i.editReply("❌ You are not linked. Use `/link` first.");
		const userId = await robloxUserIdFromUsername(username);
		if (!userId) return i.editReply("❌ Invalid Roblox account.");
		try {
			await publishToRoblox(TOPIC, {
				type: "discord_boost",
				robloxUsername: username,
				robloxUserId: userId,
				reason: "Discord Boost Reward",
				reward: {
					id: DEFAULT_PET_ID,
					amount: 1,
					rarity: "normal",
				},
				ts: Date.now(),
			});
			await i.editReply("✅ Your boost reward has been sent!");
		} catch (err) {
			console.error(err);
			await i.editReply("⚠️ Failed to send reward.");
		}
		return;
	}

	if (i.commandName === "grantpet") {
		if (!i.replied && !i.deferred) await i.deferReply({ flags: 64 });
		if (!isOwner(i.user.id)) {
			await i.editReply("This command is owner-only.");
			return;
		}

		try {
			const targetDiscordUser = i.options.getUser("discorduser", false);
			const robloxUsernameArg = i.options.getString("roblox_username", false)?.trim();
			const petIdArg = i.options.getInteger("petid", false);
			const petNameArg = i.options.getString("petname", false)?.trim();
			const amountArg = i.options.getInteger("amount", false);
			const rarityArg = normRarity(i.options.getString("rarity", false) || DEFAULT_RARITY);
			const reason = i.options.getString("reason", false) || "You’ve received a special admin reward!";

			const amount = Number(amountArg ?? DEFAULT_AMOUNT) || 1;
			let robloxUsername = null,
				robloxUserId = null,
				resolvedVia = null;

			if (robloxUsernameArg) {
				robloxUsername = robloxUsernameArg;
				robloxUserId = await robloxUserIdFromUsername(robloxUsername);
				resolvedVia = "roblox_username";
			} else if (targetDiscordUser) {
				const links = loadMap();
				const linked = links[targetDiscordUser.id];
				if (!linked) {
					await i.editReply(`Selected Discord user <@${targetDiscordUser.id}> is not linked.`);
					return;
				}
				robloxUsername = linked;
				robloxUserId = await robloxUserIdFromUsername(robloxUsername);
				resolvedVia = "discord_link";
			} else {
				await i.editReply("You must provide either roblox_username or discorduser.");
				return;
			}

			if (!robloxUserId) {
				await i.editReply(`I couldn’t find Roblox user **${robloxUsername}**.`);
				return;
			}

			const payloadReward = petNameArg
				? { kind: "pet", name: petNameArg, amount, rarity: rarityArg }
				: { kind: "pet", id: Number(petIdArg ?? DEFAULT_PET_ID) || 5000000, amount, rarity: rarityArg };

			let publishError = false,
				queueError = false;

			try {
				await publishToRoblox(TOPIC, {
					type: "discord_boost_admin",
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
			} catch {
				publishError = true;
			}

			try {
				const queueItem = {
					amount,
					rarity: rarityArg,
					reason,
					admin: true,
					discordId: i.user.id,
					discordTag: i.user.username,
				};
				if (payloadReward.name) {
					queueItem.petName = payloadReward.name;
				} else {
					queueItem.petId = payloadReward.id;
				}
				await enqueueViaOpenCloud(robloxUserId, queueItem);
			} catch {
				queueError = true;
			}

			if (!publishError || !queueError) {
				await i.editReply(
					[
						"✅ **Grant queued**",
						`• Roblox: **${robloxUsername}** (ID: ${robloxUserId})`,
						targetDiscordUser ? `• Discord: <@${targetDiscordUser.id}>` : null,
						`• Reward: ${petNameArg ? petNameArg : `Pet ${payloadReward.id}`} × ${amount}`,
						`• Rarity: ${rarityArg}`,
						reason ? `• Reason: ${reason}` : null,
						`• Via: ${resolvedVia}`,
						"• Delivery: instant if online; otherwise on next join",
					]
						.filter(Boolean)
						.join("\n")
				);
			} else {
				await i.editReply("⚠️ Grant queued locally but Roblox publish may have failed. Check console.");
			}
		} catch (e) {
			console.error("Grantpet critical error:", e);
			await i.editReply("❌ Unexpected internal error while processing grant.");
		}
		return;
	}
});

// ---------------- START ----------------
client.once(Events.ClientReady, c => {
	console.log(`✅ Logged in as ${c.user.tag}`);
});
client.login(process.env.BOT_TOKEN);

app.listen(PORT, () => console.log(`Proxy active on port ${PORT}`));
