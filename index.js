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
  PermissionsBitField,
  MessageFlags,
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
const coinClearConfirmations = new Map();

let panelRefreshTimer = null;
let panelNextRefreshAt = null;
const PANEL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

let rankingRewardTimer = null;
const RANKING_REWARD_CHECK_INTERVAL_MS = 10 * 60 * 1000;

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

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isQuestion(t) {
  return (
    /[?？嗎嘛呢喔欸了诶ㄛㄟ]$/.test(t) ||
    t.includes("幾點") ||
    t.includes("沒有") ||
    t.includes("是否") ||
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

function pad2(num) {
  return String(num).padStart(2, "0");
}

function getTaipeiDate(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000);
}

function getMonthlyPeriodKey(date = new Date()) {
  const taipei = getTaipeiDate(date);
  const year = taipei.getUTCFullYear();
  const month = pad2(taipei.getUTCMonth() + 1);

  return `${year}-${month}`;
}

function getPreviousMonthlyPeriodKey(date = new Date()) {
  const taipei = getTaipeiDate(date);
  let year = taipei.getUTCFullYear();
  let month = taipei.getUTCMonth();

  if (month === 0) {
    year -= 1;
    month = 12;
  }

  return `${year}-${pad2(month)}`;
}

function getWeeklyStartDate(date = new Date()) {
  const taipei = getTaipeiDate(date);
  const year = taipei.getUTCFullYear();
  const month = taipei.getUTCMonth();
  const day = taipei.getUTCDate();
  const weekDay = taipei.getUTCDay();
  const mondayOffset = (weekDay + 6) % 7;

  return new Date(Date.UTC(year, month, day - mondayOffset));
}

function formatDateKey(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function getWeeklyPeriodKey(date = new Date()) {
  return formatDateKey(getWeeklyStartDate(date));
}

function getPreviousWeeklyPeriodKey(date = new Date()) {
  const currentWeekStart = getWeeklyStartDate(date);
  const previousWeekStart = new Date(
    currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000
  );

  return formatDateKey(previousWeekStart);
}

function getMonthlyPeriodLabel(periodKey) {
  const [year, month] = periodKey.split("-");
  const lastDay = new Date(Number(year), Number(month), 0).getDate();

  return `${Number(month)}/1 ~ ${Number(month)}/${lastDay}`;
}

function getWeeklyPeriodLabel(periodKey) {
  const start = new Date(`${periodKey}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

  return `${start.getUTCMonth() + 1}/${start.getUTCDate()} ~ ${
    end.getUTCMonth() + 1
  }/${end.getUTCDate()}`;
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

function getRankingButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_rank_month")
      .setLabel("月排行榜")
      .setEmoji("📅")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("wt_rank_week")
      .setLabel("週排行榜")
      .setEmoji("🗓️")
      .setStyle(ButtonStyle.Primary)
  );
}

function getBackToTotalRankingButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_rank_total")
      .setLabel("返回總排行榜")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Secondary)
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

async function saveActiveSession(userId, username, startTime) {
  await pool.query(
    `
    INSERT INTO active_work_sessions (user_id, username, start_time)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      username = $2,
      start_time = $3
    `,
    [userId, username, startTime]
  );
}

async function removeActiveSession(userId) {
  await pool.query(
    `
    DELETE FROM active_work_sessions
    WHERE user_id = $1
    `,
    [userId]
  );
}

async function loadActiveSessions() {
  const result = await pool.query(`
    SELECT user_id, start_time
    FROM active_work_sessions
  `);

  workStartTimes.clear();

  for (const row of result.rows) {
    workStartTimes.set(row.user_id, Number(row.start_time));
  }

  console.log(`已恢復 ${result.rows.length} 位上班中的打工人`);
}

async function addPeriodWork(userId, username, sec) {
  const monthlyPeriodKey = getMonthlyPeriodKey();
  const weeklyPeriodKey = getWeeklyPeriodKey();

  await pool.query(
    `
    INSERT INTO work_monthly_totals (period_key, user_id, username, total_seconds)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (period_key, user_id)
    DO UPDATE SET
      total_seconds = work_monthly_totals.total_seconds + $4,
      username = $3
    `,
    [monthlyPeriodKey, userId, username, sec]
  );

  await pool.query(
    `
    INSERT INTO work_weekly_totals (period_key, user_id, username, total_seconds)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (period_key, user_id)
    DO UPDATE SET
      total_seconds = work_weekly_totals.total_seconds + $4,
      username = $3
    `,
    [weeklyPeriodKey, userId, username, sec]
  );
}

async function addWork(userId, username, sec) {
  const earnedCoins = Math.floor((Number(sec) / 3600) * 10);

  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
    VALUES ($1, $2, $3, 0, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_seconds = work_totals.total_seconds + $3,
      coins = work_totals.coins + $4,
      username = $2
    `,
    [userId, username, sec, earnedCoins]
  );

  await addPeriodWork(userId, username, sec);
}

async function addMood(userId, username, score) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
    VALUES ($1, $2, 0, $3, 0)
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

async function addCoins(userId, username, amount) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
    VALUES ($1, $2, 0, 0, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      coins = work_totals.coins + $3,
      username = $2
    `,
    [userId, username, amount]
  );
}

async function clearCoins(userId) {
  await pool.query(
    `
    UPDATE work_totals
    SET coins = 0
    WHERE user_id = $1
    `,
    [userId]
  );
}

async function clearWork(userId) {
  await pool.query(`DELETE FROM work_totals WHERE user_id = $1`, [userId]);
}

async function getCurrentMonthlyBestEmployee() {
  const result = await pool.query(
    `
    SELECT user_id, username, title
    FROM current_special_titles
    WHERE title_key = 'monthly_best_employee'
    LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function setCurrentMonthlyBestEmployee(userId, username, periodKey) {
  await pool.query(
    `
    INSERT INTO current_special_titles (title_key, user_id, username, title, awarded_period_key)
    VALUES ('monthly_best_employee', $1, $2, '本月最佳員工', $3)
    ON CONFLICT (title_key)
    DO UPDATE SET
      user_id = $1,
      username = $2,
      title = '本月最佳員工',
      awarded_period_key = $3
    `,
    [userId, username, periodKey]
  );
}

async function clearCurrentMonthlyBestEmployee() {
  await pool.query(
    `
    DELETE FROM current_special_titles
    WHERE title_key = 'monthly_best_employee'
    `
  );
}

function getDisplayTitle(level, userId, monthlyBestEmployee) {
  if (monthlyBestEmployee && monthlyBestEmployee.user_id === userId) {
    return "本月最佳員工";
  }

  return getTitle(level);
}

async function getUserTotalData(userId) {
  const result = await pool.query(
    `
    SELECT total_seconds, mood_score, coins
    FROM work_totals
    WHERE user_id = $1
    `,
    [userId]
  );

  return result.rows[0] || {
    total_seconds: 0,
    mood_score: 0,
    coins: 0,
  };
}

async function getSelfStatusEmbed(user) {
  const data = await getUserTotalData(user.id);
  const monthlyBestEmployee = await getCurrentMonthlyBestEmployee();

  const savedSeconds = Number(data.total_seconds) || 0;
  const moodScore = Number(data.mood_score) || 0;
  const coins = Number(data.coins) || 0;

  const startTime = workStartTimes.get(user.id);
  const isWorking = Boolean(startTime);

  const currentWorkSeconds = isWorking
    ? Math.floor((Date.now() - startTime) / 1000)
    : 0;

  const totalWithCurrent = savedSeconds + currentWorkSeconds;
  const levelInfo = getLevelInfo(totalWithCurrent);
  const title = getDisplayTitle(levelInfo.level, user.id, monthlyBestEmployee);

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
        name: "金幣",
        value: `🪙 ${coins}`,
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
    .setFooter({ text: "WorkTime Bot Personal Interface" })
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

  const monthlyBestEmployee = await getCurrentMonthlyBestEmployee();
  const topLevelInfo = getLevelInfo(Number(result.rows[0].total_seconds));
  embed.setColor(getTitleColor(topLevelInfo.level));

  let description = "";

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const medal =
      i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

    const levelInfo = getLevelInfo(Number(row.total_seconds));
    const title = getDisplayTitle(levelInfo.level, row.user_id, monthlyBestEmployee);

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

async function getMonthlyRankingEmbed() {
  const periodKey = getMonthlyPeriodKey();

  const result = await pool.query(
    `
    SELECT user_id, username, total_seconds
    FROM work_monthly_totals
    WHERE period_key = $1
    ORDER BY total_seconds DESC
    LIMIT 10
    `,
    [periodKey]
  );

  const embed = new EmbedBuilder()
    .setTitle("📅 月排行榜")
    .setDescription(`統計區間：${getMonthlyPeriodLabel(periodKey)}`)
    .setFooter({ text: "WorkTime Bot Monthly Ranking" })
    .setTimestamp();

  if (result.rows.length === 0) {
    embed.setDescription(`統計區間：${getMonthlyPeriodLabel(periodKey)}\n\n目前還沒有月排行榜資料。`);
    return embed;
  }

  let description = `統計區間：${getMonthlyPeriodLabel(periodKey)}\n\n`;

  result.rows.forEach((row, index) => {
    const medal =
      index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;

    description += `${medal} <@${row.user_id}>｜${formatTime(row.total_seconds)}\n`;
  });

  embed.setDescription(description);

  try {
    const topUser = await client.users.fetch(result.rows[0].user_id);
    embed.setThumbnail(topUser.displayAvatarURL({ size: 256 }));
  } catch {
    // 抓不到頭像時略過
  }

  return embed;
}

async function getWeeklyRankingEmbed() {
  const periodKey = getWeeklyPeriodKey();

  const result = await pool.query(
    `
    SELECT user_id, username, total_seconds
    FROM work_weekly_totals
    WHERE period_key = $1
    ORDER BY total_seconds DESC
    LIMIT 10
    `,
    [periodKey]
  );

  const embed = new EmbedBuilder()
    .setTitle("🗓️ 週排行榜")
    .setDescription(`統計區間：${getWeeklyPeriodLabel(periodKey)}`)
    .setFooter({ text: "WorkTime Bot Weekly Ranking" })
    .setTimestamp();

  if (result.rows.length === 0) {
    embed.setDescription(`統計區間：${getWeeklyPeriodLabel(periodKey)}\n\n目前還沒有週排行榜資料。`);
    return embed;
  }

  let description = `統計區間：${getWeeklyPeriodLabel(periodKey)}\n\n`;

  result.rows.forEach((row, index) => {
    const medal =
      index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;

    description += `${medal} <@${row.user_id}>｜${formatTime(row.total_seconds)}\n`;
  });

  embed.setDescription(description);

  try {
    const topUser = await client.users.fetch(result.rows[0].user_id);
    embed.setThumbnail(topUser.displayAvatarURL({ size: 256 }));
  } catch {
    // 抓不到頭像時略過
  }

  return embed;
}

async function distributeMonthlyRewards(periodKey) {
  const alreadyClaimed = await pool.query(
    `
    SELECT 1
    FROM ranking_rewards_claimed
    WHERE reward_type = 'monthly' AND period_key = $1
    `,
    [periodKey]
  );

  if (alreadyClaimed.rows.length > 0) return;

  const result = await pool.query(
    `
    SELECT user_id, username, total_seconds
    FROM work_monthly_totals
    WHERE period_key = $1
    ORDER BY total_seconds DESC
    LIMIT 3
    `,
    [periodKey]
  );

  if (result.rows.length === 0) {
    await clearCurrentMonthlyBestEmployee();

    await pool.query(
      `
      INSERT INTO ranking_rewards_claimed (reward_type, period_key, claimed_at)
      VALUES ('monthly', $1, $2)
      ON CONFLICT (reward_type, period_key) DO NOTHING
      `,
      [periodKey, Date.now()]
    );

    return;
  }

  const rewards = [500, 300, 200];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    await addCoins(row.user_id, row.username, rewards[i]);
  }

  const firstPlace = result.rows[0];
  await setCurrentMonthlyBestEmployee(firstPlace.user_id, firstPlace.username, periodKey);

  await pool.query(
    `
    INSERT INTO ranking_rewards_claimed (reward_type, period_key, claimed_at)
    VALUES ('monthly', $1, $2)
    ON CONFLICT (reward_type, period_key) DO NOTHING
    `,
    [periodKey, Date.now()]
  );

  console.log(`已發放 ${periodKey} 月排行榜獎勵。`);
}

async function distributeWeeklyRewards(periodKey) {
  const alreadyClaimed = await pool.query(
    `
    SELECT 1
    FROM ranking_rewards_claimed
    WHERE reward_type = 'weekly' AND period_key = $1
    `,
    [periodKey]
  );

  if (alreadyClaimed.rows.length > 0) return;

  const result = await pool.query(
    `
    SELECT user_id, username, total_seconds
    FROM work_weekly_totals
    WHERE period_key = $1
    ORDER BY total_seconds DESC
    LIMIT 3
    `,
    [periodKey]
  );

  if (result.rows.length === 0) {
    await pool.query(
      `
      INSERT INTO ranking_rewards_claimed (reward_type, period_key, claimed_at)
      VALUES ('weekly', $1, $2)
      ON CONFLICT (reward_type, period_key) DO NOTHING
      `,
      [periodKey, Date.now()]
    );

    return;
  }

  const rewards = [200, 150, 100];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    await addCoins(row.user_id, row.username, rewards[i]);
  }

  await pool.query(
    `
    INSERT INTO ranking_rewards_claimed (reward_type, period_key, claimed_at)
    VALUES ('weekly', $1, $2)
    ON CONFLICT (reward_type, period_key) DO NOTHING
    `,
    [periodKey, Date.now()]
  );

  console.log(`已發放 ${periodKey} 週排行榜獎勵。`);
}

async function checkAndDistributeRankingRewards() {
  const previousMonthKey = getPreviousMonthlyPeriodKey();
  const previousWeekKey = getPreviousWeeklyPeriodKey();

  await distributeMonthlyRewards(previousMonthKey);
  await distributeWeeklyRewards(previousWeekKey);
}

function startRankingRewardTimer() {
  if (rankingRewardTimer) {
    clearInterval(rankingRewardTimer);
  }

  rankingRewardTimer = setInterval(async () => {
    try {
      await checkAndDistributeRankingRewards();
    } catch (error) {
      console.error("檢查週/月排行榜獎勵時發生錯誤：", error);
    }
  }, RANKING_REWARD_CHECK_INTERVAL_MS);
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
        "👤 **我的狀態**：查看自己的等級、經驗、心情與上班狀態",
        "🏆 **排行榜**：查看總工時排名",
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

async function clearPanelChannelMessages(channel) {
  let deletedTotal = 0;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });

    if (messages.size === 0) break;

    const deleted = await channel.bulkDelete(messages, true).catch((error) => {
      console.error("清除面板頻道訊息時發生錯誤：", error);
      return null;
    });

    if (!deleted || deleted.size === 0) break;

    deletedTotal += deleted.size;

    if (messages.size < 100) break;
  }

  return deletedTotal;
}

async function refreshPanelChannel() {
  const panelChannelId = process.env.PANEL_CHANNEL_ID;

  if (!panelChannelId) {
    console.log("未設定 PANEL_CHANNEL_ID，略過自動刷新面板。");
    return;
  }

  const channel = await client.channels.fetch(panelChannelId).catch((error) => {
    console.error("取得面板頻道失敗：", error);
    return null;
  });

  if (!channel || !channel.isTextBased()) {
    console.error("PANEL_CHANNEL_ID 指定的頻道無效或不是文字頻道。");
    return;
  }

  const deletedTotal = await clearPanelChannelMessages(channel);
  await channel.send(getPanel());

  console.log(`面板頻道已刷新，刪除 ${deletedTotal} 則訊息並重新發送面板。`);
}

function startPanelRefreshTimer() {
  if (panelRefreshTimer) {
    clearInterval(panelRefreshTimer);
  }

  panelNextRefreshAt = Date.now() + PANEL_REFRESH_INTERVAL_MS;

  panelRefreshTimer = setInterval(async () => {
    try {
      await refreshPanelChannel();
      panelNextRefreshAt = Date.now() + PANEL_REFRESH_INTERVAL_MS;
    } catch (error) {
      console.error("自動刷新面板時發生錯誤：", error);
      panelNextRefreshAt = Date.now() + PANEL_REFRESH_INTERVAL_MS;
    }
  }, PANEL_REFRESH_INTERVAL_MS);
}

async function resetPanelRefreshTimerAndRunNow() {
  await refreshPanelChannel();
  startPanelRefreshTimer();
}

function getPanelRefreshRemainingText() {
  if (!panelNextRefreshAt) {
    return "目前尚未啟動面板自動刷新計時器。";
  }

  const remainingMs = Math.max(0, panelNextRefreshAt - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);

  return `距離下一次面板清空與重發還剩：${formatTime(totalSeconds)}`;
}

async function startWork(userId, username) {
  const startTime = Date.now();

  workStartTimes.set(userId, startTime);
  await saveActiveSession(userId, username, startTime);

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
    await removeActiveSession(userId);

    return {
      ok: false,
      text: "你的上班紀錄已經超過 24 小時了，這次不計算喔～",
    };
  }

  const sec = Math.floor(diffMs / 1000);
  await addWork(userId, username, sec);

  workStartTimes.delete(userId);
  await removeActiveSession(userId);

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
        mood_score INT DEFAULT 0,
        coins BIGINT DEFAULT 0
      );
    `);

    await pool.query(`
      ALTER TABLE work_totals
      ADD COLUMN IF NOT EXISTS mood_score INT DEFAULT 0;
    `);

    await pool.query(`
      ALTER TABLE work_totals
      ADD COLUMN IF NOT EXISTS coins BIGINT DEFAULT 0;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_work_sessions (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        start_time BIGINT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_monthly_totals (
        period_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        total_seconds BIGINT DEFAULT 0,
        PRIMARY KEY (period_key, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_weekly_totals (
        period_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        total_seconds BIGINT DEFAULT 0,
        PRIMARY KEY (period_key, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ranking_rewards_claimed (
        reward_type TEXT NOT NULL,
        period_key TEXT NOT NULL,
        claimed_at BIGINT NOT NULL,
        PRIMARY KEY (reward_type, period_key)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS current_special_titles (
        title_key TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT,
        title TEXT NOT NULL,
        awarded_period_key TEXT
      );
    `);

    await loadActiveSessions();

    console.log("資料表確認完成");

    await checkAndDistributeRankingRewards();
    startRankingRewardTimer();

    await refreshPanelChannel();
    startPanelRefreshTimer();
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
          flags: MessageFlags.Ephemeral,
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
      const text = await startWork(userId, username);

      await interaction.reply({
        content: `${interaction.user} ${text}`,
      });
      return;
    }

    if (interaction.customId === "wt_end") {
      const result = await endWork(userId, username);

      await interaction.reply({
        content: `${interaction.user} ${result.text}`,
      });

      if (result.ok) {
        await interaction.followUp({
          content:
            "今天工作感覺如何？請選擇一個心情評分：\n😄 良好 +2｜🙂 還行 +1｜😐 沒啥 0｜😵 超爛 -1｜💀 爛透了 -2",
          components: [getMoodButtons(userId)],
          flags: MessageFlags.Ephemeral,
        });
      }

      return;
    }

    if (interaction.customId === "wt_query") {
      const embed = await getWorkingEmbed();

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.customId === "wt_rank") {
      const embed = await getRankingEmbed();

      await interaction.reply({
        embeds: [embed],
        components: [getRankingButtons()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.customId === "wt_rank_month") {
      const embed = await getMonthlyRankingEmbed();

      await interaction.update({
        embeds: [embed],
        components: [getBackToTotalRankingButton()],
      });
      return;
    }

    if (interaction.customId === "wt_rank_week") {
      const embed = await getWeeklyRankingEmbed();

      await interaction.update({
        embeds: [embed],
        components: [getBackToTotalRankingButton()],
      });
      return;
    }

    if (interaction.customId === "wt_rank_total") {
      const embed = await getRankingEmbed();

      await interaction.update({
        embeds: [embed],
        components: [getRankingButtons()],
      });
      return;
    }

    if (interaction.customId === "wt_status") {
      const embed = await getSelfStatusEmbed(interaction.user);

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.customId === "wt_help") {
      await interaction.reply({
        content:
          "📖 指令：\n`!面板`\n`!查詢`\n`!排行榜`\n`!我的狀態`\n`!wt add worktime @人 秒數` [僅提供開發Debug使用]\n`!wt remove worktime @人` [僅提供開發Debug使用]\n`!wt add workmood @人 指數` [僅提供開發Debug使用]\n`!wt remove workmood @人` [僅提供開發Debug使用]\n`!wt add coin @人 數量` [僅提供開發Debug使用]\n`!wt remove coin @人` [僅提供開發Debug使用]\n`!強制上班 @人` [僅提供開發Debug使用]\n`!強制下班 @人` [僅提供開發Debug使用]",
        flags: MessageFlags.Ephemeral,
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
const coinPending = coinClearConfirmations.get(uid);

if (clearPending || moodPending || coinPending) {
  if (c.toUpperCase() !== "Y") {
    clearConfirmations.delete(uid);
    moodResetConfirmations.delete(uid);
    coinClearConfirmations.delete(uid);

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

  if (coinPending) {
    await clearCoins(coinPending.id);
    coinClearConfirmations.delete(uid);

    msg.reply(`已清除 ${coinPending.name} 的金幣。`);
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

    if (c === "!wt panel timer") {
      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

      msg.reply(getPanelRefreshRemainingText());
      return;
    }

    if (c === "!wt refresh panel") {
      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

      await resetPanelRefreshTimerAndRunNow();
      msg.reply("已立即刷新面板頻道，並重新開始 1 小時計時器。");
      return;
    }

    if (c.startsWith("!wt add worktime")) {

        if (!isAdmin(msg.member)) {
          msg.reply("你沒有權限使用這個指令。");
          return;
        }

      const u = msg.mentions.users.first();
      const sec = Number(c.split(/\s+/)[4]);

      if (!u || !Number.isFinite(sec) || sec <= 0) {
        msg.reply("格式錯誤：`!wt add worktime @人 秒數`");
        return;
      }

      const currentStartTime = workStartTimes.get(u.id);

      if (!currentStartTime) {
        msg.reply("這位打工人目前沒有上班紀錄ㄛ！");
        return;
      }

      const newStartTime = currentStartTime - sec * 1000;

      workStartTimes.set(u.id, newStartTime);
      await saveActiveSession(u.id, u.username, newStartTime);

      msg.reply(`已為 ${u.username} 的本次上班時間增加 ${formatTime(sec)}。`);
      return;
    }

    if (c.startsWith("!wt remove worktime")) {

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

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

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

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

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

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

    if (c.startsWith("!wt add coin")) {

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

      const u = msg.mentions.users.first();
      const amount = Number(c.split(/\s+/)[4]);

      if (!u || !Number.isFinite(amount) || amount <= 0) {
        msg.reply("格式錯誤：`!wt add coin @人 數量`");
        return;
      }

      await addCoins(u.id, u.username, amount);
      msg.reply(`已為 ${u.username} 增加 🪙 ${amount} 金幣。`);
      return;
    }

    if (c.startsWith("!wt remove coin")) {

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

      const u = msg.mentions.users.first();

      if (!u) {
        msg.reply("格式錯誤：`!wt remove coin @人`");
        return;
      }

      coinClearConfirmations.set(uid, {
        id: u.id,
        name: u.username,
      });

      msg.reply(`⚠️ 即將清除 ${u.username} 的金幣，請輸入 \`Y\` 確認。`);
      return;
    }

    if (c.startsWith("!強制上班")) {

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }
      
      const u = msg.mentions.users.first();
      if (!u) {
        msg.reply("格式錯誤：`!強制上班 @人`");
        return;
      }

      const startTime = now;

      workStartTimes.set(u.id, startTime);
      await saveActiveSession(u.id, u.username, startTime);

      msg.reply(`${u.username} 已被強制設定為上班中。`);
      return;
    }

    if (c.startsWith("!強制下班")) {

      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

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
      const text = await startWork(uid, msg.author.username);
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