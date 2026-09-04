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

const Groq = require("groq-sdk");
const fs = require("fs");

// ==============================
// CLIENT
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const OWNER_ID = process.env.OWNER_ID;
const DB_FILE = "./keys.json";

// ==============================
// DATABASE
// ==============================

let db = {
  keys: {},
  users: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    if (!db.keys) db.keys = {};
    if (!db.users) db.users = {};
  } catch {
    console.log("Database error. Creating new database.");
  }
}

function saveDB() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

// ==============================
// KEY GENERATOR
// ==============================

function generateKey() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  let key = "";

  for (let i = 0; i < 16; i++) {
    key += characters[
      Math.floor(Math.random() * characters.length)
    ];
  }

  return key;
}

function createKey(duration) {
  let key;

  do {
    key = generateKey();
  } while (db.keys[key]);

  db.keys[key] = {
    duration: duration,
    createdAt: Date.now(),

    used: false,
    usedBy: null,
    usedUsername: null,
    redeemedAt: null
  };

  saveDB();

  return key;
}

// ==============================
// ACCESS CHECK
// ==============================

function hasAccess(userId) {

  // Owner is permanent.
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

// ==============================
// TIME LEFT
// ==============================

function getTimeLeft(userId) {

  if (userId === OWNER_ID) {
    return "♾️ Permanent";
  }

  const user = db.users[userId];

  if (!user) {
    return null;
  }

  const remaining =
    user.expiresAt - Date.now();

  if (remaining <= 0) {

    delete db.users[userId];

    saveDB();

    return null;
  }

  const days =
    Math.floor(remaining / 86400000);

  const hours =
    Math.floor(
      (remaining % 86400000) / 3600000
    );

  const minutes =
    Math.floor(
      (remaining % 3600000) / 60000
    );

  return `${days}d ${hours}h ${minutes}m`;
}

// ==============================
// DURATION PARSER
// ==============================

function parseDuration(text) {

  text = text.toLowerCase();

  // "a week"
  if (
    text.includes("a week") ||
    text.includes("one week")
  ) {
    return 7 * 86400000;
  }

  // "a day"
  if (
    text.includes("a day") ||
    text.includes("one day")
  ) {
    return 86400000;
  }

  // days
  let match = text.match(
    /(\d+)\s*(day|days|d)\b/
  );

  if (match) {
    return Number(match[1]) * 86400000;
  }

  // weeks
  match = text.match(
    /(\d+)\s*(week|weeks|wk|w)\b/
  );

  if (match) {
    return Number(match[1]) *
      7 *
      86400000;
  }

  // months
  match = text.match(
    /(\d+)\s*(month|months|mo)\b/
  );

  if (match) {
    return Number(match[1]) *
      30 *
      86400000;
  }

  // hours
  match = text.match(
    /(\d+)\s*(hour|hours|hr|hrs|h)\b/
  );

  if (match) {
    return Number(match[1]) *
      3600000;
  }

  return null;
}

function durationName(ms) {

  const days = ms / 86400000;

  if (Number.isInteger(days)) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  const hours = ms / 3600000;

  if (Number.isInteger(hours)) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return "custom duration";
}

// ==============================
// KEYSYSTEM PANEL
// ==============================

async function sendKeySystem(channel) {

  const embed = new EmbedBuilder()
    .setTitle("🔐 Access Key System")
    .setDescription(
      "You need a valid access key to use this bot.\n\n" +
      "🔑 Each key can only be used once.\n" +
      "⏳ Access expires when your timer ends."
    );

  const button = new ButtonBuilder()
    .setCustomId("redeem_access")
    .setLabel("Redeem Access Key")
    .setEmoji("🔑")
    .setStyle(ButtonStyle.Primary);

  const row =
    new ActionRowBuilder()
      .addComponents(button);

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

// ==============================
// GROQ AI
// ==============================

async function understandRequest(text) {

  try {

    const completion =
      await groq.chat.completions.create({

        model: "openai/gpt-oss-20b",

        temperature: 0,

        messages: [

          {
            role: "system",

            content: `
You are the natural-language command interpreter
for a Discord access-key bot.

You ONLY interpret what the user wants.

Return ONLY valid JSON.

Possible actions:

generate_key
keysystem
timeleft
unknown

For generate_key:

{
  "action": "generate_key",
  "durationText": "requested duration"
}

For keysystem:

{
  "action": "keysystem"
}

For timeleft:

{
  "action": "timeleft"
}

For unknown:

{
  "action": "unknown"
}

Examples:

"gen me a week access key"
=> generate_key, durationText "a week"

"make me a 15 day key"
=> generate_key, durationText "15 days"

"I need a key for 2 weeks"
=> generate_key, durationText "2 weeks"

"open the access keysystem"
=> keysystem

"show the key system"
=> keysystem

"how much time do I have"
=> timeleft

NEVER generate keys yourself.

NEVER grant access yourself.

NEVER change owner permissions.

NEVER output anything except JSON.
`
          },

          {
            role: "user",
            content: text
          }

        ]
      });

    const output =
      completion.choices?.[0]?.message?.content
      || "";

    try {

      return JSON.parse(output);

    } catch {

      // Sometimes models put JSON in a code block.
      const match =
        output.match(/\{[\s\S]*\}/);

      if (match) {
        return JSON.parse(match[0]);
      }

      return {
        action: "unknown"
      };
    }

  } catch (error) {

    console.error(
      "Groq error:",
      error.message
    );

    return {
      action: "error"
    };
  }
}

// ==============================
// REDEEM BUTTON
// ==============================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

    if (
      interaction.customId !==
      "redeem_access"
    ) {
      return;
    }

    const modal =
      new ModalBuilder()
        .setCustomId("redeem_modal")
        .setTitle("Redeem Access Key");

    const input =
      new TextInputBuilder()
        .setCustomId("access_key")
        .setLabel("Enter your 16-character key")
        .setPlaceholder("XXXXXXXXXXXXXXXX")
        .setStyle(TextInputStyle.Short)
        .setMinLength(16)
        .setMaxLength(16)
        .setRequired(true);

    const row =
      new ActionRowBuilder()
        .addComponents(input);

    modal.addComponents(row);

    await interaction.showModal(modal);
  }
);

// ==============================
// REDEEM KEY
// ==============================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isModalSubmit()) {
      return;
    }

    if (
      interaction.customId !==
      "redeem_modal"
    ) {
      return;
    }

    const key =
      interaction.fields
        .getTextInputValue("access_key")
        .trim()
        .toUpperCase();

    const keyData =
      db.keys[key];

    // Invalid key
    if (!keyData) {

      return interaction.reply({
        content:
          "❌ Invalid access key.",
        ephemeral: true
      });
    }

    // Already used
    if (keyData.used) {

      return interaction.reply({
        content:
          "❌ This key has already been used.",
        ephemeral: true
      });
    }

    // Already has access
    if (
      hasAccess(interaction.user.id)
    ) {

      return interaction.reply({
        content:
          "⚠️ You already have active access.",
        ephemeral: true
      });
    }

    // Mark key as used
    keyData.used = true;
    keyData.usedBy =
      interaction.user.id;

    keyData.usedUsername =
      interaction.user.username;

    keyData.redeemedAt =
      Date.now();

    // Give access
    db.users[interaction.user.id] = {

      key: key,

      username:
        interaction.user.username,

      redeemedAt:
        Date.now(),

      expiresAt:
        Date.now() +
        keyData.duration
    };

    saveDB();

    await interaction.reply({

      content:
        `✅ **Access Granted!**\n\n` +
        `👤 **User:** ${interaction.user.username}\n` +
        `⏳ **Duration:** ${durationName(keyData.duration)}\n` +
        `🔑 **Key:** \`${key}\`\n\n` +
        `Your access is now active.`,

      ephemeral: true
    });
  }
);

// ==============================
// NATURAL LANGUAGE MESSAGES
// ==============================

client.on(
  Events.MessageCreate,
  async message => {

    if (message.author.bot) {
      return;
    }

    // Only process messages mentioning bot.
    if (
      !message.mentions.users.has(
        client.user.id
      )
    ) {
      return;
    }

    const text =
      message.content
        .replace(
          new RegExp(
            `<@!?${client.user.id}>`,
            "g"
          ),
          ""
        )
        .trim();

    if (!text) {
      return;
    }

    // ==========================
    // OWNER
    // ==========================

    if (
      message.author.id === OWNER_ID
    ) {

      const result =
        await understandRequest(text);

      // AI error
      if (result.action === "error") {

        return message.reply(
          "⚠️ AI service is temporarily unavailable."
        );
      }

      // Generate key
      if (
        result.action ===
        "generate_key"
      ) {

        const duration =
          parseDuration(
            result.durationText ||
            text
          );

        if (!duration) {

          return message.reply(
            "❌ I couldn't understand the duration. Try `@Bot generate me a 15 day access key`."
          );
        }

        const key =
          createKey(duration);

        // DM owner
        try {

          await message.author.send(

            `🔐 **ACCESS KEY GENERATED**\n\n` +

            `🔑 Key: \`${key}\`\n` +

            `⏳ Duration: **${durationName(duration)}**\n` +

            `🟢 Status: **Unused**\n\n` +

            `⚠️ This key can only be redeemed once.`
          );

        } catch {

          return message.reply(
            "❌ Key was generated, but I couldn't DM you. Enable DMs from this server."
          );
        }

        // Temporary confirmation
        const reply =
          await message.reply(
            `✅ Key generated and sent to your DMs.\n⏳ ${durationName(duration)}`
          );

        // Delete confirmation
        // so the key itself isn't left
        // visible in the channel.
        setTimeout(() => {

          reply.delete()
            .catch(() => {});

        }, 5000);

        return;
      }

      // Key system
      if (
        result.action ===
        "keysystem"
      ) {

        return sendKeySystem(
          message.channel
        );
      }

      // Time left
      if (
        result.action ===
        "timeleft"
      ) {

        return message.reply(
          `⏳ Your access: **${getTimeLeft(message.author.id)}**`
        );
      }
    }

    // ==========================
    // NON-OWNER
    // ==========================

    const lower =
      text.toLowerCase();

    // Let everyone open keysystem.
    if (
      lower.includes("keysystem") ||
      lower.includes("key system") ||
      lower.includes("redeem")
    ) {

      return sendKeySystem(
        message.channel
      );
    }

    // Protected bot
    if (
      !hasAccess(
        message.author.id
      )
    ) {

      return message.reply(
        "🔒 **Access denied.** Redeem a valid access key first."
      );
    }

    // ==========================
    // YOUR PROTECTED AI/BOT
    // ==========================

    await message.reply(
      "✅ You have active access. Your request was received."
    );
  }
);

// ==============================
// LOGIN
// ==============================

client.once(
  Events.ClientReady,
  () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `👑 Owner ID: ${OWNER_ID}`
    );

  }
);

client.login(
  process.env.DISCORD_TOKEN
);
