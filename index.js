require("dotenv").config();

const { Pool } = require("pg");
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const workStartTimes = new Map();
const clearConfirmations = new Map();

const workReplies = [
  "又是辛勤工作的一天呢！上班要加油窩～ 💖！",
  "努力奮鬥打工人！！打工才是人上人！！",
  "今天也是超級打工人喔！加油歐力給～！",
  "上班辛苦啦～今天也順順利利！",
  "打工魂燃燒🔥 今天也是賺錢的一天！",
  "出勤打工啦！今天要賺飽飽～",
  "工作開始！記得喝水💧",
  "今天也準時上班，優秀！",
  "打工人上線！",
  "今天也要加油喔！",
];

const offWorkReplies = [
  "辛苦啦~ 💖 今天又工作了 {time} 呢！",
  "終於下班了！今天撐了 {time}🔥",
  "下班快樂！努力了 {time}😴",
  "收工啦～今天 {time} 👍",
  "打工人辛苦了！{time}",
  "今日工時 {time}，辛苦你了！",
  "任務完成！{time}",
  "你今天真的很努力：{time}",
  "完美收工！{time}",
  "辛苦一整天：{time}",
];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTime(sec) {
  const safeSec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = safeSec % 60;
  return `${h}小時${m}分${s}秒`;
}

function isAllowedChannel(id) {
  if (process.env.CHANNEL_IDS) {
    return process.env.CHANNEL_IDS
      .split(",")
      .map((v) => v.trim())
      .includes(id);
  }
  return id === process.env.CHANNEL_ID;
}

function isQuestion(t) {
  return (
    /[?？嗎嘛呢喔]$/.test(t) ||
    t.includes("幾點") ||
    t.includes("什麼時候")
  );
}

function isOther(t) {
  return (
    t.includes("你") ||
    t.includes("他") ||
    t.includes("她") ||
    t.includes("有人")
  );
}

function isStart(t) {
  return t.includes("上班") && !isQuestion(t) && !isOther(t);
}

function isEnd(t) {
  return t.includes("下班") && !isQuestion(t) && !isOther(t);
}

async function addWork(userId, username, sec) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_seconds = work_totals.total_seconds + $3,
      username = $2
    `,
    [userId, username, sec]
  );
}

async function clearWork(userId) {
  await pool.query(`DELETE FROM work_totals WHERE user_id = $1`, [userId]);
}

async function getRankingEmbed() {
  const result = await pool.query(`
    SELECT user_id, username, total_seconds
    FROM work_totals
    ORDER BY total_seconds DESC
    LIMIT 10
  `);

  const embed = new EmbedBuilder()
    .setTitle("🏆 打工人總工時排行榜")
    .setDescription("依照累積總工時排序")
    .setFooter({ text: "WorkTime Bot Ranking System" })
    .setTimestamp();

  if (result.rows.length === 0) {
    embed.setDescription("目前還沒有排行榜資料。");
    return embed;
  }

  let description = "";

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

    description += `${medal} <@${row.user_id}>｜${formatTime(row.total_seconds)}\n`;
  }

  embed.setDescription(description);

  try {
    const topUser = await client.users.fetch(result.rows[0].user_id);
    embed.setThumbnail(topUser.displayAvatarURL({ size: 256 }));
  } catch {
    // 抓不到頭像時略過
  }

  return embed;
}

async function getWorkingEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("📋 目前上班中的打工人")
    .setTimestamp();

  if (workStartTimes.size === 0) {
    embed.setDescription("目前沒有任何打工人在上班ㄛ～");
    return embed;
  }

  let description = "";

  for (const [userId, start] of workStartTimes) {
    const user = await client.users.fetch(userId);
    const sec = Math.floor((Date.now() - start) / 1000);
    description += `👤 <@${userId}>｜${formatTime(sec)}\n`;
  }

  embed.setDescription(description);
  return embed;
}

function getPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🧾 WorkTime Bot 打工系統")
    .setDescription(
      [
        "使用下方按鈕快速操作：",
        "",
        "🟢 **上班**：開始紀錄你的上班時間",
        "🔴 **下班**：結束本次上班並加入排行榜",
        "📋 **查詢**：查看目前誰正在上班",
        "🏆 **排行榜**：查看總工時排名",
        "❔ **幫助**：查看所有指令",
      ].join("\n")
    )
    .setFooter({ text: "WorkTime Bot Control Panel" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_start")
      .setLabel("上班")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("wt_end")
      .setLabel("下班")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("wt_query")
      .setLabel("查詢")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("wt_rank")
      .setLabel("排行榜")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_help")
      .setLabel("幫助")
      .setEmoji("❔")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

async function startWork(userId, username) {
  workStartTimes.set(userId, Date.now());
  return getRandom(workReplies);
}

async function endWork(userId, username) {
  const start = workStartTimes.get(userId);

  if (!start) {
    return {
      ok: false,
      text: "你目前沒有上班紀錄喔～",
    };
  }

  const diffMs = Date.now() - start;

  if (diffMs > 24 * 60 * 60 * 1000) {
    workStartTimes.delete(userId);
    return {
      ok: false,
      text: "你的上班紀錄已經超過 24 小時了，這次不計算喔～",
    };
  }

  const sec = Math.floor(diffMs / 1000);
  await addWork(userId, username, sec);
  workStartTimes.delete(userId);

  return {
    ok: true,
    text: getRandom(offWorkReplies).replace("{time}", formatTime(sec)),
  };
}

client.once(Events.ClientReady, async () => {
  console.log(`BOT 已上線：${client.user.tag}`);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_totals (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        total_seconds BIGINT DEFAULT 0
      );
    `);

    console.log("資料表確認完成");
  } catch (error) {
    console.error("資料表確認失敗：", error);
  }
});

// ===== 按鈕互動 =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (!isAllowedChannel(interaction.channelId)) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (interaction.customId === "wt_start") {
      const text = await startWork(userId, username);

      await interaction.reply({
        content: `${interaction.user} ${text}`,
        ephemeral: false,
      });
      return;
    }

    if (interaction.customId === "wt_end") {
      const result = await endWork(userId, username);

      await interaction.reply({
        content: `${interaction.user} ${result.text}`,
        ephemeral: false,
      });
      return;
    }

    if (interaction.customId === "wt_query") {
      const embed = await getWorkingEmbed();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "wt_rank") {
      const embed = await getRankingEmbed();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "wt_help") {
      await interaction.reply({
        content:
          "📖 指令：\n`!面板`\n`!查詢`\n`!排行榜`\n`!wt add worktime @人 秒數`\n`!wt clear worktime @人`\n`!強制上班 @人`\n`!強制下班 @人`",
        ephemeral: true,
      });
      return;
    }
  } catch (error) {
    console.error("處理按鈕時發生錯誤：", error);
  }
});

// ===== 文字指令 =====
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!isAllowedChannel(msg.channel.id)) return;

    const c = msg.content.trim();
    const uid = msg.author.id;
    const now = Date.now();

    if (c.toUpperCase() === "Y") {
      const p = clearConfirmations.get(uid);
      if (!p) return;

      await clearWork(p.id);
      clearConfirmations.delete(uid);

      msg.reply(`已清除 ${p.name} 的排行榜紀錄。`);
      return;
    }

    if (c === "!面板" || c === "!幫助") {
      await msg.reply(getPanel());
      return;
    }

    if (c === "!查詢") {
      const embed = await getWorkingEmbed();
      msg.reply({ embeds: [embed] });
      return;
    }

    if (c === "!排行榜") {
      const embed = await getRankingEmbed();
      msg.reply({ embeds: [embed] });
      return;
    }

    if (c.startsWith("!wt add worktime")) {
      const u = msg.mentions.users.first();
      const sec = Number(c.split(/\s+/)[4]);

      if (!u || !Number.isFinite(sec) || sec <= 0) {
        msg.reply("格式錯誤：`!wt add worktime @人 秒數`");
        return;
      }

      await addWork(u.id, u.username, sec);
      msg.reply(`已為 ${u.username} 增加 ${formatTime(sec)} 總工時。`);
      return;
    }

    if (c.startsWith("!wt clear worktime")) {
      const u = msg.mentions.users.first();
      if (!u) {
        msg.reply("格式錯誤：`!wt clear worktime @人`");
        return;
      }

      clearConfirmations.set(uid, {
        id: u.id,
        name: u.username,
      });

      msg.reply(`⚠️ 即將清除 ${u.username} 的排行榜紀錄，請輸入 \`Y\` 確認。`);
      return;
    }

    if (c.startsWith("!強制上班")) {
      const u = msg.mentions.users.first();
      if (!u) {
        msg.reply("格式錯誤：`!強制上班 @人`");
        return;
      }

      workStartTimes.set(u.id, now);
      msg.reply(`${u.username} 已被強制設定為上班中。`);
      return;
    }

    if (c.startsWith("!強制下班")) {
      const u = msg.mentions.users.first();
      if (!u) {
        msg.reply("格式錯誤：`!強制下班 @人`");
        return;
      }

      const result = await endWork(u.id, u.username);
      msg.reply(`${u.username} ${result.text}`);
      return;
    }

    if (isStart(c)) {
      const text = await startWork(uid, msg.author.username);
      msg.reply(`${msg.author} ${text}`);
      return;
    }

    if (isEnd(c)) {
      const result = await endWork(uid, msg.author.username);
      msg.reply(`${msg.author} ${result.text}`);
    }
  } catch (error) {
    console.error("處理訊息時發生錯誤：", error);
  }
});

pool.on("error", (error) => {
  console.error("資料庫連線錯誤：", error);
});

client.login(process.env.TOKEN);