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
const moodResetConfirmations = new Map();

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

function getLevelInfo(totalSeconds) {
  const totalHours = totalSeconds / 3600;
  const level = Math.floor(totalHours / 5);
  const currentLevelHours = totalHours % 5;
  const percent = Math.floor((currentLevelHours / 5) * 100);

  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  return { level, percent, bar };
}

function getTitle(level) {
  if (level >= 100) return "公司守護神";
  if (level >= 90) return "摸魚大宗師";
  if (level >= 80) return "部門活化石";
  if (level >= 70) return "甩鍋藝術家";
  if (level >= 60) return "報告製造機";
  if (level >= 50) return "專案邊緣人";
  if (level >= 40) return "資深救火隊";
  if (level >= 30) return "會議記錄員";
  if (level >= 20) return "職場工具人";
  if (level >= 10) return "鍵盤敲擊工";
  if (level >= 5) return "茶水間萌新";
  if (level >= 1) return "職場新鮮人";
  return "社會新鮮人";
}

function getTitleColor(level) {
  if (level >= 100) return 0xf1c40f;
  if (level >= 90) return 0x1abc9c;
  if (level >= 80) return 0x95a5a6;
  if (level >= 70) return 0x9b59b6;
  if (level >= 60) return 0xe67e22;
  if (level >= 50) return 0x34495e;
  if (level >= 40) return 0xe74c3c;
  if (level >= 30) return 0x3498db;
  if (level >= 20) return 0x2980b9;
  if (level >= 10) return 0x2ecc71;
  if (level >= 5) return 0x27ae60;
  if (level >= 1) return 0x7f8c8d;
  return 0x95a5a6;
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

function getMoodText(score, username) {
  const s = Number(score) || 0;

  if (s >= 20) return `${username} 已經愛上工作了，根本是打工之神`;
  if (s >= 15) return `${username} 非常熱愛這份工作`;
  if (s >= 10) return `${username} 似乎很喜歡他的工作`;
  if (s >= 5) return `${username} 還蠻享受工作的`;
  if (s >= 1) return `${username} 覺得工作還算不錯`;
  if (s === 0) return `${username} 對工作沒什麼特別感覺`;
  if (s >= -4) return `${username} 有點不太想上班`;
  if (s >= -9) return `${username} 似乎不是很喜歡他的工作`;
  if (s >= -14) return `${username} 似乎很討厭他的工作`;
  if (s >= -19) return `${username} 已經開始厭世了`;
  return `${username} 已經徹底不想上班了`;
}

function getMoodButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mood:${userId}:2`)
      .setLabel("良好")
      .setEmoji("😄")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`mood:${userId}:1`)
      .setLabel("還行")
      .setEmoji("🙂")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`mood:${userId}:0`)
      .setLabel("沒啥")
      .setEmoji("😐")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`mood:${userId}:-1`)
      .setLabel("超爛")
      .setEmoji("😵")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`mood:${userId}:-2`)
      .setLabel("爛透了")
      .setEmoji("💀")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendMoodPrompt(user) {
  try {
    await user.send({
      content:
        "今天下班啦～請幫今天的工作心情打個分數：\n\n" +
        "😄 良好：+2\n" +
        "🙂 還行：+1\n" +
        "😐 沒啥：0\n" +
        "😵 超爛：-1\n" +
        "💀 爛透了：-2",
      components: [getMoodButtons(user.id)],
    });
  } catch {
    // 使用者關閉私訊時略過
  }
}

async function addWork(userId, username, sec) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_seconds = work_totals.total_seconds + $3,
      username = $2
    `,
    [userId, username, sec]
  );
}

async function addMood(userId, username, score) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score)
    VALUES ($1, $2, 0, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      mood_score = work_totals.mood_score + $3,
      username = $2
    `,
    [userId, username, score]
  );
}

async function resetMood(userId) {
  await pool.query(
    `
    UPDATE work_totals
    SET mood_score = 0
    WHERE user_id = $1
    `,
    [userId]
  );
}

async function clearWork(userId) {
  await pool.query(`DELETE FROM work_totals WHERE user_id = $1`, [userId]);
}

async function getUserTotalData(userId) {
  const result = await pool.query(
    `
    SELECT total_seconds, mood_score
    FROM work_totals
    WHERE user_id = $1
    `,
    [userId]
  );

  return result.rows[0] || {
    total_seconds: 0,
    mood_score: 0,
  };
}

async function getSelfStatusEmbed(user) {
  const data = await getUserTotalData(user.id);

  const savedSeconds = Number(data.total_seconds) || 0;
  const moodScore = Number(data.mood_score) || 0;

  const startTime = workStartTimes.get(user.id);
  const isWorking = Boolean(startTime);

  const currentWorkSeconds = isWorking
    ? Math.floor((Date.now() - startTime) / 1000)
    : 0;

  const totalWithCurrent = savedSeconds + currentWorkSeconds;
  const levelInfo = getLevelInfo(totalWithCurrent);
  const title = getTitle(levelInfo.level);

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${user.username} 的打工狀態`)
    .setColor(getTitleColor(levelInfo.level))
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: "目前狀態",
        value: isWorking ? "🟢 上班中" : "⚪ 目前未上班",
        inline: true,
      },
      {
        name: "總工作時長",
        value: formatTime(totalWithCurrent),
        inline: true,
      },
      {
        name: "目前上班時長",
        value: isWorking ? formatTime(currentWorkSeconds) : "目前沒有正在上班",
        inline: false,
      },
      {
        name: "等級",
        value: `Lv.${levelInfo.level}　${levelInfo.percent}%`,
        inline: true,
      },
      {
        name: "稱號",
        value: title,
        inline: true,
      },
      {
        name: "經驗條",
        value: `\`${levelInfo.bar}\``,
        inline: false,
      },
      {
        name: "目前上班心情",
        value: `${getMoodText(moodScore, user.username)}\n心情指數：${moodScore}`,
        inline: false,
      }
    )
    .setFooter({ text: "每 5 小時升 1 等" })
    .setTimestamp();

  return embed;
}

async function getRankingEmbed() {
  const result = await pool.query(`
    SELECT user_id, username, total_seconds, mood_score
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

  const topLevelInfo = getLevelInfo(Number(result.rows[0].total_seconds));
  embed.setColor(getTitleColor(topLevelInfo.level));

  let description = "";

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const medal =
      i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

    const levelInfo = getLevelInfo(Number(row.total_seconds));
    const title = getTitle(levelInfo.level);

    description += `${medal} <@${row.user_id}>｜${formatTime(
      row.total_seconds
    )}｜Lv.${levelInfo.level}｜${title}\n`;

    if (i === 0) {
      description += `💭 ${getMoodText(
        row.mood_score,
        row.username
      )}（心情指數：${row.mood_score}）\n`;
    }

    description += "\n";
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
        "👤 **我的狀態**：查看自己的等級、經驗、心情與上班狀態",
        "❔ **幫助**：查看所有指令",
      ].join("\n")
    )
    .setFooter({ text: "WorkTime Bot Control Panel" })
    .setTimestamp();

const row1 = new ActionRowBuilder().addComponents(
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

  // 👇 改到這裡（我的狀態上來）
  new ButtonBuilder()
    .setCustomId("wt_status")
    .setLabel("我的狀態")
    .setEmoji("👤")
    .setStyle(ButtonStyle.Primary)
);

const row2 = new ActionRowBuilder().addComponents(
  // 👇 排行榜下去
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

  return { embeds: [embed], components: [row1, row2] };
}

async function startWork(userId) {
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
        total_seconds BIGINT DEFAULT 0,
        mood_score INT DEFAULT 0
      );
    `);

    await pool.query(`
      ALTER TABLE work_totals
      ADD COLUMN IF NOT EXISTS mood_score INT DEFAULT 0;
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

    if (interaction.customId.startsWith("mood:")) {
      const [, targetUserId, scoreText] = interaction.customId.split(":");
      const score = Number(scoreText);

      if (interaction.user.id !== targetUserId) {
        await interaction.reply({
          content: "這不是你的心情評分按鈕喔～",
          ephemeral: true,
        });
        return;
      }

      await addMood(interaction.user.id, interaction.user.username, score);

      await interaction.update({
        content: `已記錄你的工作心情：${score > 0 ? "+" : ""}${score}`,
        components: [],
      });
      return;
    }

    if (!isAllowedChannel(interaction.channelId)) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (interaction.customId === "wt_start") {
      const text = await startWork(userId);

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

      if (result.ok) {
        await interaction.followUp({
          content:
            "今天工作感覺如何？請選擇一個心情評分：\n😄 良好 +2｜🙂 還行 +1｜😐 沒啥 0｜😵 超爛 -1｜💀 爛透了 -2",
          components: [getMoodButtons(userId)],
          ephemeral: true,
        });
      }

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

    if (interaction.customId === "wt_status") {
      const embed = await getSelfStatusEmbed(interaction.user);

      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId === "wt_help") {
      await interaction.reply({
        content:
          "📖 指令：\n`!面板`\n`!查詢`\n`!排行榜`\n`!wt add worktime @人 秒數`\n`!wt remove worktime @人`\n`!wt add workmood @人 指數`\n`!wt remove workmood @人`\n`!強制上班 @人`\n`!強制下班 @人`",
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

const clearPending = clearConfirmations.get(uid);
const moodPending = moodResetConfirmations.get(uid);

if (clearPending || moodPending) {
  if (c.toUpperCase() !== "Y") {
    clearConfirmations.delete(uid);
    moodResetConfirmations.delete(uid);

    msg.reply("已取消此次確認操作。");
    return;
  }

  if (clearPending) {
    await clearWork(clearPending.id);
    clearConfirmations.delete(uid);

    msg.reply(`已清除 ${clearPending.name} 的排行榜紀錄。`);
    return;
  }

  if (moodPending) {
    await resetMood(moodPending.id);
    moodResetConfirmations.delete(uid);

    msg.reply(`已重置 ${moodPending.name} 的心情指數為 0。`);
    return;
  }
}

    if (c === "!面板" || c === "!幫助") {
      await msg.reply(getPanel());
      return;
    }

    if (c.startsWith("!查詢")) {
      const targetUser = msg.mentions.users.first();

      if (targetUser) {
        const embed = await getSelfStatusEmbed(targetUser);
        msg.reply({ embeds: [embed] });
        return;
      }

      if (c === "!查詢") {
        const embed = await getWorkingEmbed();
        msg.reply({ embeds: [embed] });
        return;
      }
    }

    if (c === "!排行榜") {
      const embed = await getRankingEmbed();
      msg.reply({ embeds: [embed] });
      return;
    }

    if (c === "!我的狀態") {
      const embed = await getSelfStatusEmbed(msg.author);
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

    if (c.startsWith("!wt remove worktime")) {
      const u = msg.mentions.users.first();
      if (!u) {
        msg.reply("格式錯誤：`!wt remove worktime @人`");
        return;
      }

      clearConfirmations.set(uid, {
        id: u.id,
        name: u.username,
      });

      msg.reply(`⚠️ 即將清除 ${u.username} 的排行榜紀錄，請輸入 \`Y\` 確認。`);
      return;
    }

    if (c.startsWith("!wt add workmood")) {
      const u = msg.mentions.users.first();
      const score = Number(c.split(/\s+/)[4]);

      if (!u || !Number.isFinite(score)) {
        msg.reply("格式錯誤：`!wt add workmood @人 指數`");
        return;
      }

      await addMood(u.id, u.username, score);
      msg.reply(`已為 ${u.username} 增加心情指數 ${score > 0 ? "+" : ""}${score}。`);
      return;
    }

    if (c.startsWith("!wt remove workmood")) {
      const u = msg.mentions.users.first();

      if (!u) {
        msg.reply("格式錯誤：`!wt remove workmood @人`");
        return;
      }

      moodResetConfirmations.set(uid, {
        id: u.id,
        name: u.username,
      });

      msg.reply(`⚠️ 即將重置 ${u.username} 的心情指數為 0，請輸入 \`Y\` 確認。`);
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

      if (result.ok) {
        await sendMoodPrompt(u);
      }

      return;
    }

    if (isStart(c)) {
      const text = await startWork(uid);
      msg.reply(`${msg.author} ${text}`);
      return;
    }

    if (isEnd(c)) {
      const result = await endWork(uid, msg.author.username);
      msg.reply(`${msg.author} ${result.text}`);

      if (result.ok) {
        await sendMoodPrompt(msg.author);
      }
    }
  } catch (error) {
    console.error("處理訊息時發生錯誤：", error);
  }
});

pool.on("error", (error) => {
  console.error("資料庫連線錯誤：", error);
});

client.login(process.env.TOKEN);