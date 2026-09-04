require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events
} = require("discord.js");

const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// =========================
// CONFIG
// =========================

const OWNER_ID = process.env.OWNER_ID;

// =========================
// DATABASE
// =========================

const DB_FILE = "./keys.json";

let db = {
  keys: {},
  users: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    console.log("Database was invalid. Creating a new one.");
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// =========================
// KEY GENERATOR
// =========================

function generateKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  let key = "";

  for (let i = 0; i < 16; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }

  return key;
}

// =========================
// ACCESS
// =========================

function hasAccess(userId) {
  if (userId === OWNER_ID) {
    return true;
  }

  const user = db.users[userId];

  if (!user) {
    return false;
  }

  if (Date.now() >= user.expiresAt) {
    delete db.users[userId];
    saveDB();
    return false;
  }

  return true;
}

function getTimeLeft(userId) {
  if (userId === OWNER_ID) {
    return "♾️ Permanent";
  }

  const user = db.users[userId];

  if (!user) {
    return null;
  }

  const remaining = user.expiresAt - Date.now();

  if (remaining <= 0) {
    delete db.users[userId];
    saveDB();
    return null;
  }

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor(
    (remaining % 86400000) / 3600000
  );
  const minutes = Math.floor(
    (remaining % 3600000) / 60000
  );

  return `${days}d ${hours}h ${minutes}m`;
}

// =========================
// DURATION PARSER
// =========================

function parseDuration(text) {
  text = text.toLowerCase();

  // days
  let match = text.match(/(\d+)\s*(day|days|d)\b/);

  if (match) {
    return Number(match[1]) * 24 * 60 * 60 * 1000;
  }

  // weeks
  match = text.match(/(\d+)\s*(week|weeks|wk|w)\b/);

  if (match) {
    return Number(match[1]) * 7 * 24 * 60 * 60 * 1000;
  }

  // months
  match = text.match(/(\d+)\s*(month|months|mo)\b/);

  if (match) {
    return Number(match[1]) * 30 * 24 * 60 * 60 * 1000;
  }

  // hours
  match = text.match(/(\d+)\s*(hour|hours|hr|hrs|h)\b/);

  if (match) {
    return Number(match[1]) * 60 * 60 * 1000;
  }

  // one week / a week
  if (
    text.includes("a week") ||
    text.includes("one week")
  ) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  // one day / a day
  if (
    text.includes("a day") ||
    text.includes("one day")
  ) {
    return 24 * 60 * 60 * 1000;
  }

  return null;
}

function durationName(ms) {
  const days = ms / 86400000;

  if (days >= 1 && Number.isInteger(days)) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  const hours = ms / 3600000;

  if (Number.isInteger(hours)) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return "custom duration";
}

// =========================
// KEY CREATION
// =========================

function createKey(duration) {
  let key;

  do {
    key = generateKey();
  } while (db.keys[key]);

  db.keys[key] = {
    duration,
    createdAt: Date.now(),
    used: false,
    usedBy: null,
    redeemedAt: null
  };

  saveDB();

  return key;
}

// =========================
// KEYSYSTEM PANEL
// =========================

async function sendKeySystem(channel) {
  const embed = new EmbedBuilder()
    .setTitle("🔐 Access Key System")
    .setDescription(
      "Redeem a valid access key to unlock the bot.\n\n" +
      "🔑 Each key can only be used once.\n" +
      "⏳ Access expires when your timer ends."
    );

  const button = new ButtonBuilder()
    .setCustomId("redeem_access")
    .setLabel("Redeem Access Key")
    .setEmoji("🔑")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

// =========================
// READY
// =========================

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// =========================
// BUTTON
// =========================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId !== "redeem_access") return;

  const modal = new ModalBuilder()
    .setCustomId("redeem_modal")
    .setTitle("Redeem Access Key");

  const input = new TextInputBuilder()
    .setCustomId("access_key")
    .setLabel("Enter your 16-character key")
    .setPlaceholder("XXXXXXXXXXXXXXXX")
    .setStyle(TextInputStyle.Short)
    .setMinLength(16)
    .setMaxLength(16)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(input);

  modal.addComponents(row);

  await interaction.showModal(modal);
});

// =========================
// REDEEM
// =========================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId !== "redeem_modal") return;

  const key = interaction.fields
    .getTextInputValue("access_key")
    .trim()
    .toUpperCase();

  const data = db.keys[key];

  if (!data) {
    return interaction.reply({
      content: "❌ Invalid access key.",
      ephemeral: true
    });
  }

  if (data.used) {
    return interaction.reply({
      content: "❌ This key has already been used.",
      ephemeral: true
    });
  }

  // Prevent stacking another active key.
  if (hasAccess(interaction.user.id)) {
    return interaction.reply({
      content: "⚠️ You already have active access.",
      ephemeral: true
    });
  }

  data.used = true;
  data.usedBy = interaction.user.id;
  data.redeemedAt = Date.now();

  db.users[interaction.user.id] = {
    key,
    redeemedAt: Date.now(),
    expiresAt: Date.now() + data.duration
  };

  saveDB();

  await interaction.reply({
    content:
      `✅ **Access granted!**\n\n` +
      `🔑 Key: \`${key}\`\n` +
      `⏳ Duration: **${durationName(data.duration)}**\n` +
      `👤 Account: **${interaction.user.username}**`,
    ephemeral: true
  });
});

// =========================
// MESSAGE / AI-LIKE COMMANDS
// =========================

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // Only react when the bot is mentioned.
  if (!message.mentions.users.has(client.user.id)) return;

  const text = message.content
    .replace(`<@${client.user.id}>`, "")
    .replace(`<@!${client.user.id}>`, "")
    .trim()
    .toLowerCase();

  // =======================
  // OWNER NATURAL LANGUAGE
  // =======================

  if (message.author.id === OWNER_ID) {

    // Generate key request
    if (
      text.includes("generate") ||
      text.includes("gen") ||
      text.includes("make")
    ) {
      const duration = parseDuration(text);

      if (!duration) {
        return message.reply(
          "❌ Tell me the duration, e.g. `@Bot gen me a week access key`."
        );
      }

      const key = createKey(duration);

      // Private-style channel response.
      // Discord normal messages cannot be truly ephemeral,
      // so we delete the trigger and response shortly afterward.
      const reply = await message.reply({
        content:
          `🔑 **Access Key Generated**\n\n` +
          `\`${key}\`\n\n` +
          `⏳ Duration: **${durationName(duration)}**\n` +
          `✅ Added to the access key system.`
      });

      // Send the key to owner's DM.
      try {
        await message.author.send(
          `🔐 **Your Access Key**\n\n` +
          `\`${key}\`\n\n` +
          `⏳ Duration: **${durationName(duration)}**\n` +
          `⚠️ This key can only be redeemed once.`
        );
      } catch {
        await reply.edit({
          content:
            `🔑 **Access Key Generated**\n\n` +
            `\`${key}\`\n\n` +
            `⏳ Duration: **${durationName(duration)}**\n` +
            `⚠️ I couldn't DM you. Please enable DMs from this server.`
        });
      }

      // Remove the public-looking message after a short time.
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);

      return;
    }

    // Keysystem
    if (
      text.includes("keysystem") ||
      text.includes("key system") ||
      text.includes("access keysystem")
    ) {
      await sendKeySystem(message.channel);
      return;
    }
  }

  // =======================
  // EVERYONE ELSE
  // =======================

  if (
    text.includes("keysystem") ||
    text.includes("key system")
  ) {
    await sendKeySystem(message.channel);
    return;
  }

  // =======================
  // ACCESS CHECK
  // =======================

  if (!hasAccess(message.author.id)) {
    return message.reply(
      "🔒 **Access denied.** Redeem a valid access key first."
    );
  }

  // Your protected bot features go here.

  await message.reply(
    "✅ You have active access. Your request was received."
  );
});

// =========================
// SLASH-LIKE COMMANDS
// =========================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "timeleft") {

    if (!hasAccess(interaction.user.id)) {
      return interaction.reply({
        content: "🔒 You don't have active access.",
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        `⏳ **Access remaining:** ${getTimeLeft(interaction.user.id)}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "keysystem") {
    return sendKeySystem(interaction.channel);
  }
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
