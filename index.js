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
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
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
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const workStartTimes = new Map();
const voiceStartTimes = new Map();

const clearConfirmations = new Map();
const moodResetConfirmations = new Map();
const coinClearConfirmations = new Map();

const VOICE_COIN_RATE_PER_HOUR = 100;

const pendingLoanApplications = new Map();
const pendingRepayments = new Map();

const BANK_OWNER_ID = "495480158648795138";
const BANK_OWNER_NAME = "Hizu Jin";
const MAX_LOAN_INSTALLMENTS = 72;

let panelRefreshTimer = null;
let panelNextRefreshAt = null;

// 預設仍維持舊版：每 1 小時刷新一次。
// 當管理員使用 /wt-admin panel-refresh minute:x second:y 後，會切換成「每小時固定第 x 分 y 秒刷新」。
let panelRefreshMode = "interval";
let panelRefreshIntervalMs = 60 * 60 * 1000;
let panelRefreshFixedMinute = 0;
let panelRefreshFixedSecond = 0;

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

function formatCoins(num) {
  return `${Number(num || 0).toLocaleString("zh-TW")}`;
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

function parsePositiveInteger(value) {
  const cleaned = String(value || "").replace(/,/g, "").trim();
  const num = Number(cleaned);

  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
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

function getBankMainButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_borrow")
      .setLabel("我要借款")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("wt_bank_repay")
      .setLabel("我要還款")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("wt_bank_query")
      .setLabel("查詢貸款案件")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getBankBackButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_borrow")
      .setLabel("重新申請")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("wt_bank_back")
      .setLabel("返回銀行")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getLoanConfirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_accept_loan")
      .setLabel("同意對保")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("wt_bank_reject_loan")
      .setLabel("拒絕對保")
      .setStyle(ButtonStyle.Danger)
  );
}

function getBackToBankButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_back")
      .setLabel("返回銀行")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getRepayConfirmButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_confirm_repay")
      .setLabel("確認還款")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("wt_bank_cancel_repay")
      .setLabel("取消還款")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("wt_bank_back")
      .setLabel("返回銀行")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getLoanCaseButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_bank_repay")
      .setLabel("我要還款")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("wt_bank_back")
      .setLabel("返回銀行")
      .setStyle(ButtonStyle.Secondary)
  );
}

function createLoanModal() {
  const modal = new ModalBuilder()
    .setCustomId("wt_bank_borrow_modal")
    .setTitle("Hizu Jin 信託商業銀行");

  const amountInput = new TextInputBuilder()
    .setCustomId("loan_amount")
    .setLabel("我想要貸款的金額為...")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("例如：10000");

  const installmentsInput = new TextInputBuilder()
    .setCustomId("loan_installments")
    .setLabel("我想要分期的期數為...")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("最多72期");

  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(installmentsInput)
  );

  return modal;
}

function createRepaySelect(remainingInstallments) {
  const baseOptions = [1, 2, 3, 6, 12].filter(
    (n) => n <= remainingInstallments
  );

  const options = baseOptions.map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`還 ${n} 期`)
      .setValue(String(n))
      .setDescription(`本次償還 ${n} 期貸款`)
  );

  // 避免「一次還清」和前面的還款期數 value 重複
  if (!baseOptions.includes(remainingInstallments)) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("一次還清")
        .setValue(String(remainingInstallments))
        .setDescription(`一次償還剩餘 ${remainingInstallments} 期`)
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("wt_bank_repay_select")
    .setPlaceholder("請選擇要還幾期")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
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

async function saveActiveVoiceSession(userId, username, channelId, startTime) {
  await pool.query(
    `
    INSERT INTO active_voice_sessions (user_id, username, channel_id, start_time)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET
      username = $2,
      channel_id = $3,
      start_time = $4
    `,
    [userId, username, channelId, startTime]
  );
}

async function updateActiveVoiceChannel(userId, channelId) {
  await pool.query(
    `
    UPDATE active_voice_sessions
    SET channel_id = $1
    WHERE user_id = $2
    `,
    [channelId, userId]
  );
}

async function removeActiveVoiceSession(userId) {
  await pool.query(
    `
    DELETE FROM active_voice_sessions
    WHERE user_id = $1
    `,
    [userId]
  );
}

async function loadActiveVoiceSessions() {
  const result = await pool.query(`
    SELECT user_id, username, channel_id, start_time
    FROM active_voice_sessions
  `);

  voiceStartTimes.clear();

  for (const row of result.rows) {
    voiceStartTimes.set(row.user_id, {
      username: row.username,
      channelId: row.channel_id,
      startTime: Number(row.start_time),
    });
  }

  console.log(`已恢復 ${result.rows.length} 位語音在線中的打工人`);
}

async function addVoiceTimeAndReward(userId, username, voiceSeconds) {
  const safeSeconds = Math.max(0, Number(voiceSeconds) || 0);
  const earnedCoins = Math.floor(
    (safeSeconds / 3600) * VOICE_COIN_RATE_PER_HOUR
  );

  await pool.query(
    `
    INSERT INTO voice_totals (user_id, username, total_seconds, coins, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_seconds = voice_totals.total_seconds + $3,
      coins = voice_totals.coins + $4,
      username = $2,
      updated_at = $5
    `,
    [userId, username, safeSeconds, earnedCoins, Date.now()]
  );

  if (earnedCoins > 0) {
    await addCoins(userId, username, earnedCoins);
  }

  return earnedCoins;
}

async function getVoiceRankingEmbed() {
  const result = await pool.query(`
    SELECT user_id, username, total_seconds, coins
    FROM voice_totals
    WHERE total_seconds > 0
    ORDER BY total_seconds DESC
    LIMIT 25
  `);

  const embed = new EmbedBuilder()
    .setTitle("🎧 語音在線時長排行榜")
    .setColor(0x66c5eb)
    .setFooter({ text: "WorkTime Bot Voice Online System｜最多顯示 25 位" })
    .setTimestamp();

  if (result.rows.length === 0) {
    embed.setDescription("目前還沒有任何語音在線累積紀錄。");
    return embed;
  }

  let description = "";

  result.rows.forEach((row, index) => {
    const medal =
      index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;

    const active = voiceStartTimes.get(row.user_id);
    const activeSeconds = active
      ? Math.floor((Date.now() - active.startTime) / 1000)
      : 0;

    const totalWithActive = Number(row.total_seconds) + activeSeconds;

    description += `${medal} <@${row.user_id}>｜${formatTime(totalWithActive)}｜🪙 ${formatCoins(row.coins)}\n`;
  });

  if (voiceStartTimes.size > 0) {
    description += "\n━━━━━━━━━━━━━━━━━━━━\n";
    description += "🟢 **目前正在語音中：**\n";

    let count = 0;

    for (const [userId, session] of voiceStartTimes) {
      if (count >= 25) break;

      const sec = Math.floor((Date.now() - session.startTime) / 1000);
      description += `<@${userId}>｜本次在線 ${formatTime(sec)}\n`;
      count++;
    }
  }

  embed.setDescription(description);
  return embed;
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
  const earnedCoins = Math.floor((Number(sec) / 3600) * 192);

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

function getDurationSecondsFromOptions(interaction) {
  const hours = interaction.options.getInteger("hours") || 0;
  const minutes = interaction.options.getInteger("minutes") || 0;
  const seconds = interaction.options.getInteger("seconds") || 0;

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return {
    hours,
    minutes,
    seconds,
    totalSeconds,
  };
}

function isConfirmYes(value) {
  return String(value || "").trim().toUpperCase() === "YES";
}

async function reduceWorkTime(userId, seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const monthlyPeriodKey = getMonthlyPeriodKey();
  const weeklyPeriodKey = getWeeklyPeriodKey();

  await pool.query(
    `
    UPDATE work_totals
    SET total_seconds = GREATEST(0, total_seconds - $1)
    WHERE user_id = $2
    `,
    [safeSeconds, userId]
  );

  await pool.query(
    `
    UPDATE work_monthly_totals
    SET total_seconds = GREATEST(0, total_seconds - $1)
    WHERE user_id = $2 AND period_key = $3
    `,
    [safeSeconds, userId, monthlyPeriodKey]
  );

  await pool.query(
    `
    UPDATE work_weekly_totals
    SET total_seconds = GREATEST(0, total_seconds - $1)
    WHERE user_id = $2 AND period_key = $3
    `,
    [safeSeconds, userId, weeklyPeriodKey]
  );
}

async function clearWorkTimeOnly(userId) {
  workStartTimes.delete(userId);

  await pool.query(
    `
    UPDATE work_totals
    SET total_seconds = 0
    WHERE user_id = $1
    `,
    [userId]
  );

  await pool.query(
    `
    DELETE FROM work_monthly_totals
    WHERE user_id = $1
    `,
    [userId]
  );

  await pool.query(
    `
    DELETE FROM work_weekly_totals
    WHERE user_id = $1
    `,
    [userId]
  );

  await removeActiveSession(userId);
}

async function reduceMood(userId, username, amount) {
  const safeAmount = Math.max(0, Number(amount) || 0);

  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
    VALUES ($1, $2, 0, $3, 0)
    ON CONFLICT (user_id)
    DO UPDATE SET
      mood_score = work_totals.mood_score - $3,
      username = $2
    `,
    [userId, username, safeAmount]
  );
}

async function reduceCoins(userId, username, amount) {
  const safeAmount = Math.max(0, Number(amount) || 0);

  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
    VALUES ($1, $2, 0, 0, 0)
    ON CONFLICT (user_id)
    DO UPDATE SET
      coins = GREATEST(0, work_totals.coins - $3),
      username = $2
    `,
    [userId, username, safeAmount]
  );
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

async function getBankSettings() {
  const result = await pool.query(
    `
    SELECT setting_key, setting_value
    FROM bank_settings
    WHERE setting_key IN ('loan_min_rate', 'loan_max_rate')
    `
  );

  const settings = {
    minRate: 0.5,
    maxRate: 1,
  };

  for (const row of result.rows) {
    if (row.setting_key === "loan_min_rate") {
      settings.minRate = Number(row.setting_value);
    }

    if (row.setting_key === "loan_max_rate") {
      settings.maxRate = Number(row.setting_value);
    }
  }

  if (!Number.isFinite(settings.minRate) || settings.minRate <= 0) {
    settings.minRate = 0.5;
  }

  if (!Number.isFinite(settings.maxRate) || settings.maxRate < settings.minRate) {
    settings.maxRate = 1;
  }

  return settings;
}

async function setBankRates(minRate, maxRate) {
  await pool.query(
    `
    INSERT INTO bank_settings (setting_key, setting_value)
    VALUES ('loan_min_rate', $1)
    ON CONFLICT (setting_key)
    DO UPDATE SET setting_value = $1
    `,
    [String(minRate)]
  );

  await pool.query(
    `
    INSERT INTO bank_settings (setting_key, setting_value)
    VALUES ('loan_max_rate', $1)
    ON CONFLICT (setting_key)
    DO UPDATE SET setting_value = $1
    `,
    [String(maxRate)]
  );
}

function getLoanCreditLimit(totalSeconds) {
  return Math.floor((Number(totalSeconds) || 0) / 3600) * 1000;
}

function calculateLoanRate(amount, creditLimit, settings) {
  const minRate = settings.minRate;
  const maxRate = settings.maxRate;
  const range = maxRate - minRate;

  if (!creditLimit || creditLimit <= 0) return maxRate;

  const ratio = amount / creditLimit;

  if (ratio <= 0.25) return maxRate;
  if (ratio <= 0.5) return Number((minRate + range * 0.6).toFixed(4));
  if (ratio <= 0.75) return Number((minRate + range * 0.3).toFixed(4));
  return minRate;
}

async function getActiveLoan(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM bank_loans
    WHERE user_id = $1 AND status = 'active'
    ORDER BY loan_id DESC
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getBankOwnerUser() {
  return client.users.fetch(BANK_OWNER_ID).catch(() => null);
}

async function getBankEmbed(user) {
  const data = await getUserTotalData(user.id);
  const activeLoan = await getActiveLoan(user.id);
  const bankOwner = await getBankOwnerUser();

  const creditLimit = getLoanCreditLimit(Number(data.total_seconds));
  const hasLoan = Boolean(activeLoan);

  const embed = new EmbedBuilder()
    .setTitle("Hizu Jin 信託商業銀行")
    .setDescription(
      [
        `董事長：<@${BANK_OWNER_ID}>`,
        "────────────",
        "有任何資金需求，歡迎來電，圓你的發財夢，就是我的日行一善。",
        "",
        `你的可貸款額度為：${
          hasLoan ? "無法借款" : `🪙 ${formatCoins(creditLimit)}`
        }`,
        `是否有進行中的貸款：${hasLoan ? "是" : "否"}`,
        hasLoan
          ? `貸款剩餘清償期數：${activeLoan.paid_installments}/${activeLoan.installment_count}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(0xf1c40f)
    .setTimestamp();

  if (bankOwner) {
    embed.setThumbnail(bankOwner.displayAvatarURL({ size: 256 }));
  }

  return embed;
}

function getRejectedLoanEmbed(user, reason) {
  return new EmbedBuilder()
    .setTitle("經複查，本行將退回您的貸款申請")
    .setDescription(`***拒絕原因：${reason}***`)
    .setColor(0xe74c3c)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

function getLoanPreviewEmbed(user, application) {
  return new EmbedBuilder()
    .setTitle("恭喜您，經核查，本行已通過您的貸款申請")
    .setDescription(
      [
        "***請確認本行貸款單，確認後請按送出***",
        "",
        "────────────",
        "",
        `實際貸款金額：🪙 ${formatCoins(application.principal)}`,
        `還款期數：${application.installments} 期`,
        `利率：${application.rate}%`,
        `每月還款日期：每月 ${application.paymentDay} 日`,
        `實際總還款金額：🪙 ${formatCoins(application.totalRepayment)}`,
      ].join("\n")
    )
    .setColor(0x2ecc71)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

function getNoActiveLoanEmbed(user) {
  return new EmbedBuilder()
    .setTitle("貸款案件查詢")
    .setDescription("目前沒有進行中的貸款案件。")
    .setColor(0x95a5a6)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

function getLoanCaseEmbed(user, loan) {
  if (!loan) return getNoActiveLoanEmbed(user);

  const remainingInstallments =
    Number(loan.installment_count) - Number(loan.paid_installments);
  const remainingAmount =
    Number(loan.total_repayment) - Number(loan.paid_amount || 0);

  return new EmbedBuilder()
    .setTitle("貸款案件查詢")
    .setDescription(
      [
        "是否有進行中的貸款：是",
        `貸款本金：🪙 ${formatCoins(loan.principal)}`,
        `利率：${Number(loan.interest_rate)}%`,
        `總還款金額：🪙 ${formatCoins(loan.total_repayment)}`,
        `每期還款金額：🪙 ${formatCoins(loan.monthly_payment)}`,
        `已繳期數：${loan.paid_installments} / ${loan.installment_count}`,
        `剩餘期數：${remainingInstallments}`,
        `剩餘應還金額：🪙 ${formatCoins(remainingAmount)}`,
        `每月還款日期：每月 ${loan.next_payment_day} 日`,
      ].join("\n")
    )
    .setColor(0x3498db)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

function getRepaySelectEmbed(user, loan) {
  const remainingInstallments =
    Number(loan.installment_count) - Number(loan.paid_installments);
  const remainingAmount =
    Number(loan.total_repayment) - Number(loan.paid_amount || 0);

  return new EmbedBuilder()
    .setTitle("貸款還款")
    .setDescription(
      [
        "請選擇本次想要償還的期數。",
        "",
        `剩餘期數：${remainingInstallments}`,
        `剩餘應還金額：🪙 ${formatCoins(remainingAmount)}`,
      ].join("\n")
    )
    .setColor(0x3498db)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

function calculateRepaymentPreview(loan, installmentsToPay) {
  const remainingInstallments =
    Number(loan.installment_count) - Number(loan.paid_installments);
  const safeInstallments = Math.min(installmentsToPay, remainingInstallments);

  const remainingAmount =
    Number(loan.total_repayment) - Number(loan.paid_amount || 0);

  const paymentAmount = Math.min(
    Number(loan.monthly_payment) * safeInstallments,
    remainingAmount
  );

  const totalInterest = Number(loan.total_interest) || 0;
  const paidInterest = Number(loan.paid_interest) || 0;
  const remainingInterest = Math.max(0, totalInterest - paidInterest);
  const interestPerInstallment = Math.ceil(totalInterest / Number(loan.installment_count));
  const interestPaid = Math.min(
    interestPerInstallment * safeInstallments,
    remainingInterest
  );

  return {
    installments: safeInstallments,
    paymentAmount,
    interestPaid,
  };
}

async function getRepayConfirmEmbed(user, loan, installmentsToPay) {
  const data = await getUserTotalData(user.id);
  const preview = calculateRepaymentPreview(loan, installmentsToPay);

  return new EmbedBuilder()
    .setTitle("即將還款確認")
    .setDescription(
      [
        `本次還款期數：${preview.installments} 期`,
        `每期還款金額：🪙 ${formatCoins(loan.monthly_payment)}`,
        `即將消耗金額：🪙 ${formatCoins(preview.paymentAmount)}`,
        `目前剩餘金幣：🪙 ${formatCoins(data.coins)}`,
      ].join("\n")
    )
    .setColor(0xe67e22)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
}

async function createLoan(userId, username, application) {
  const now = Date.now();

  const result = await pool.query(
    `
    INSERT INTO bank_loans (
      user_id,
      username,
      principal,
      interest_rate,
      total_interest,
      paid_interest,
      total_repayment,
      installment_count,
      paid_installments,
      paid_amount,
      monthly_payment,
      next_payment_day,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 0, 0, $8, $9, 'active', $10, $10)
    RETURNING *
    `,
    [
      userId,
      username,
      application.principal,
      application.rate,
      application.totalInterest,
      application.totalRepayment,
      application.installments,
      application.monthlyPayment,
      application.paymentDay,
      now,
    ]
  );

  await addCoins(userId, username, application.principal);

  return result.rows[0];
}

async function repayLoan(user, loan, installmentsToPay) {
  const preview = calculateRepaymentPreview(loan, installmentsToPay);
  const db = await pool.connect();

  try {
    await db.query("BEGIN");

    const deductResult = await db.query(
      `
      UPDATE work_totals
      SET coins = coins - $1
      WHERE user_id = $2 AND coins >= $1
      RETURNING coins
      `,
      [preview.paymentAmount, user.id]
    );

    if (deductResult.rows.length === 0) {
      await db.query("ROLLBACK");
      return {
        ok: false,
        text: "金幣不足，無法完成還款。",
      };
    }

    await db.query(
      `
      INSERT INTO work_totals (user_id, username, total_seconds, mood_score, coins)
      VALUES ($1, $2, 0, 0, $3)
      ON CONFLICT (user_id)
      DO UPDATE SET
        coins = work_totals.coins + $3,
        username = $2
      `,
      [BANK_OWNER_ID, BANK_OWNER_NAME, preview.interestPaid]
    );

    const newPaidInstallments =
      Number(loan.paid_installments) + preview.installments;
    const newPaidAmount = Number(loan.paid_amount || 0) + preview.paymentAmount;
    const newPaidInterest =
      Number(loan.paid_interest || 0) + preview.interestPaid;

    const isPaid =
      newPaidInstallments >= Number(loan.installment_count) ||
      newPaidAmount >= Number(loan.total_repayment);

    await db.query(
      `
      UPDATE bank_loans
      SET
        paid_installments = $1,
        paid_amount = $2,
        paid_interest = $3,
        status = $4,
        updated_at = $5
      WHERE loan_id = $6
      `,
      [
        Math.min(newPaidInstallments, Number(loan.installment_count)),
        Math.min(newPaidAmount, Number(loan.total_repayment)),
        Math.min(newPaidInterest, Number(loan.total_interest)),
        isPaid ? "paid" : "active",
        Date.now(),
        loan.loan_id,
      ]
    );

    await db.query(
      `
      INSERT INTO bank_loan_payments (
        loan_id,
        user_id,
        paid_installments,
        paid_amount,
        interest_paid,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        loan.loan_id,
        user.id,
        preview.installments,
        preview.paymentAmount,
        preview.interestPaid,
        Date.now(),
      ]
    );

    await db.query("COMMIT");

    return {
      ok: true,
      text: isPaid
        ? "還款成功，您的貸款已全數清償。"
        : `還款成功，已償還 ${preview.installments} 期。`,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    console.error("還款失敗：", error);

    return {
      ok: false,
      text: "還款時發生錯誤，請稍後再試。",
    };
  } finally {
    db.release();
  }
}

async function handleLoanApplicationSubmit(interaction) {
  const user = interaction.user;
  const amount = parsePositiveInteger(
    interaction.fields.getTextInputValue("loan_amount")
  );
  const installments = parsePositiveInteger(
    interaction.fields.getTextInputValue("loan_installments")
  );

  const data = await getUserTotalData(user.id);
  const activeLoan = await getActiveLoan(user.id);
  const creditLimit = getLoanCreditLimit(Number(data.total_seconds));

  if (!amount) {
    const embed = getRejectedLoanEmbed(user, "貸款金額必須為有效正整數。");
    await interaction.reply({
      embeds: [embed],
      components: [getBankBackButtons()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!installments) {
    const embed = getRejectedLoanEmbed(user, "分期期數必須為有效正整數。");
    await interaction.reply({
      embeds: [embed],
      components: [getBankBackButtons()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (activeLoan) {
    const embed = getRejectedLoanEmbed(user, "您目前已有進行中的貸款案件。");
    await interaction.reply({
      embeds: [embed],
      components: [getBankBackButtons()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (amount > creditLimit) {
    const embed = getRejectedLoanEmbed(user, "申請金額超過您的可貸款額度。");
    await interaction.reply({
      embeds: [embed],
      components: [getBankBackButtons()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (installments > MAX_LOAN_INSTALLMENTS) {
    const embed = getRejectedLoanEmbed(user, "分期期數不可超過72期。");
    await interaction.reply({
      embeds: [embed],
      components: [getBankBackButtons()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = await getBankSettings();
  const rate = calculateLoanRate(amount, creditLimit, settings);
  const totalInterest = Math.ceil(amount * (rate / 100));
  const totalRepayment = amount + totalInterest;
  const monthlyPayment = Math.ceil(totalRepayment / installments);
  const paymentDay = getTaipeiDate().getUTCDate();

  const application = {
    principal: amount,
    installments,
    rate,
    totalInterest,
    totalRepayment,
    monthlyPayment,
    paymentDay,
  };

  pendingLoanApplications.set(user.id, application);

  const embed = getLoanPreviewEmbed(user, application);

  await interaction.reply({
    embeds: [embed],
    components: [getLoanConfirmButtons()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBankAdminCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "你沒有權限使用這個指令。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "set-rate") {
    const minRate = interaction.options.getNumber("min-rate");
    const maxRate = interaction.options.getNumber("max-rate");

    if (
      !Number.isFinite(minRate) ||
      !Number.isFinite(maxRate) ||
      minRate <= 0 ||
      maxRate <= 0 ||
      maxRate < minRate
    ) {
      await interaction.reply({
        content: "利率設定錯誤，最低利率與最高利率都必須大於 0，且最高利率不可低於最低利率。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setBankRates(minRate, maxRate);

    await interaction.reply({
      content: `已更新銀行利率範圍：${minRate}% ~ ${maxRate}%`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "info") {
    const user = interaction.options.getUser("user");
    const loan = await getActiveLoan(user.id);
    const embed = getLoanCaseEmbed(user, loan);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "clear-loan") {
    const user = interaction.options.getUser("user");

    await pool.query(
      `
      UPDATE bank_loans
      SET status = 'cancelled', updated_at = $1
      WHERE user_id = $2 AND status = 'active'
      `,
      [Date.now(), user.id]
    );

    await interaction.reply({
      content: `已取消 ${user.username} 的進行中貸款案件。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "set-paid") {
    const user = interaction.options.getUser("user");
    const paidInstallments = interaction.options.getInteger("paid-installments");
    const loan = await getActiveLoan(user.id);

    if (!loan) {
      await interaction.reply({
        content: "該用戶目前沒有進行中的貸款案件。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const safePaid = Math.max(
      0,
      Math.min(paidInstallments, Number(loan.installment_count))
    );
    const paidAmount = Math.min(
      Number(loan.monthly_payment) * safePaid,
      Number(loan.total_repayment)
    );
    const paidInterest = Math.min(
      Math.ceil(Number(loan.total_interest) / Number(loan.installment_count)) *
        safePaid,
      Number(loan.total_interest)
    );

    await pool.query(
      `
      UPDATE bank_loans
      SET
        paid_installments = $1,
        paid_amount = $2,
        paid_interest = $3,
        status = $4,
        updated_at = $5
      WHERE loan_id = $6
      `,
      [
        safePaid,
        paidAmount,
        paidInterest,
        safePaid >= Number(loan.installment_count) ? "paid" : "active",
        Date.now(),
        loan.loan_id,
      ]
    );

    await interaction.reply({
      content: `已將 ${user.username} 的已繳期數設定為 ${safePaid}/${loan.installment_count}。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "add-loan") {
    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const installments = interaction.options.getInteger("installments");

    if (amount <= 0 || installments <= 0 || installments > MAX_LOAN_INSTALLMENTS) {
      await interaction.reply({
        content: "貸款金額與期數設定錯誤，期數最多 72 期。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const activeLoan = await getActiveLoan(user.id);

    if (activeLoan) {
      await interaction.reply({
        content: "該用戶目前已有進行中的貸款案件。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const data = await getUserTotalData(user.id);
    const creditLimit = Math.max(getLoanCreditLimit(Number(data.total_seconds)), amount);
    const settings = await getBankSettings();
    const rate = calculateLoanRate(amount, creditLimit, settings);
    const totalInterest = Math.ceil(amount * (rate / 100));
    const totalRepayment = amount + totalInterest;
    const monthlyPayment = Math.ceil(totalRepayment / installments);
    const paymentDay = getTaipeiDate().getUTCDate();

    await createLoan(user.id, user.username, {
      principal: amount,
      installments,
      rate,
      totalInterest,
      totalRepayment,
      monthlyPayment,
      paymentDay,
    });

    await interaction.reply({
      content: `已為 ${user.username} 建立測試貸款：本金 ${formatCoins(amount)}，期數 ${installments}，利率 ${rate}%。`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleWtAdminCommand(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      content: "你沒有權限使用這個指令。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === "worktime") {
    const user = interaction.options.getUser("user");

    if (sub === "add") {
      const duration = getDurationSecondsFromOptions(interaction);

      if (duration.totalSeconds <= 0) {
        await interaction.reply({
          content: "請至少輸入一個大於 0 的時間。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await addWork(user.id, user.username, duration.totalSeconds);

      await interaction.reply({
        content: `已為 ${user.username} 增加工作時間 ${formatTime(
          duration.totalSeconds
        )}，並依照打工倍率發放金幣。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "reduce") {
      const duration = getDurationSecondsFromOptions(interaction);

      if (duration.totalSeconds <= 0) {
        await interaction.reply({
          content: "請至少輸入一個大於 0 的時間。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await reduceWorkTime(user.id, duration.totalSeconds);

      await interaction.reply({
        content: `已為 ${user.username} 減少工作時間 ${formatTime(
          duration.totalSeconds
        )}。此操作不會自動扣回金幣。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "clear") {
      const confirm = interaction.options.getString("confirm");

      if (!isConfirmYes(confirm)) {
        await interaction.reply({
          content: "確認失敗。若要清除工作時間，confirm 請輸入 `YES`。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await clearWorkTimeOnly(user.id);

      await interaction.reply({
        content: `已清除 ${user.username} 的工作時間、週/月工時與目前上班中紀錄；金幣與心情不受影響。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (group === "mood") {
    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    if (sub === "add") {
      await addMood(user.id, user.username, amount);

      await interaction.reply({
        content: `已為 ${user.username} 增加心情指數 +${amount}。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "reduce") {
      await reduceMood(user.id, user.username, amount);

      await interaction.reply({
        content: `已為 ${user.username} 減少心情指數 -${amount}。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "clear") {
      const confirm = interaction.options.getString("confirm");

      if (!isConfirmYes(confirm)) {
        await interaction.reply({
          content: "確認失敗。若要清除心情指數，confirm 請輸入 `YES`。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await resetMood(user.id);

      await interaction.reply({
        content: `已重置 ${user.username} 的心情指數為 0。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (group === "coin") {
    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    if (sub === "add") {
      await addCoins(user.id, user.username, amount);

      await interaction.reply({
        content: `已為 ${user.username} 增加 🪙 ${formatCoins(amount)} 金幣。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "reduce") {
      await reduceCoins(user.id, user.username, amount);

      await interaction.reply({
        content: `已為 ${user.username} 減少 🪙 ${formatCoins(
          amount
        )} 金幣，最低不會低於 0。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "clear") {
      const confirm = interaction.options.getString("confirm");

      if (!isConfirmYes(confirm)) {
        await interaction.reply({
          content: "確認失敗。若要清除金幣，confirm 請輸入 `YES`。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await clearCoins(user.id);

      await interaction.reply({
        content: `已清除 ${user.username} 的金幣。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (group === "force") {
    const user = interaction.options.getUser("user");

    if (sub === "start") {
      if (workStartTimes.has(user.id)) {
        await interaction.reply({
          content: `${user.username} 目前已經在上班中。`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const startTime = Date.now();

      workStartTimes.set(user.id, startTime);
      await saveActiveSession(user.id, user.username, startTime);

      await interaction.reply({
        content: `${user.username} 已被強制設定為上班中。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "end") {
      const result = await endWork(user.id, user.username);

      await interaction.reply({
        content: `${user.username} ${result.text}`,
        flags: MessageFlags.Ephemeral,
      });

      if (result.ok) {
        await sendMoodPrompt(user);
      }

      return;
    }
  }

  if (!group && sub === "panel-refresh") {
    const minute = interaction.options.getInteger("minute");
    const second = interaction.options.getInteger("second") || 0;

    await setFixedPanelRefreshTimeAndRunNow(minute, second);

    await interaction.reply({
      content:
        `已立即刷新 Panel，並設定之後固定於每小時 ${minute} 分 ${second} 秒刷新。\n` +
        `下一次刷新剩餘時間：${formatTime(
          Math.floor(Math.max(0, panelNextRefreshAt - Date.now()) / 1000)
        )}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!group && sub === "voice-clear") {
    const user = interaction.options.getUser("user");

    voiceStartTimes.delete(user.id);
    await removeActiveVoiceSession(user.id);

    await interaction.reply({
      content: `已清除 ${user.username} 目前進行中的語音在線暫存紀錄。永久語音累積紀錄不受影響。`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function registerSlashCommands() {
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;
  const token = process.env.TOKEN;

  if (!clientId || !guildId || !token) {
    console.log("未設定 CLIENT_ID / GUILD_ID / TOKEN，略過 Slash Command 註冊。");
    return;
  }

  const timeOptions = (sub) =>
    sub
      .addIntegerOption((option) =>
        option
          .setName("hours")
          .setDescription("小時，可留空")
          .setRequired(false)
          .setMinValue(0)
      )
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("分鐘，可留空")
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(59)
      )
      .addIntegerOption((option) =>
        option
          .setName("seconds")
          .setDescription("秒數，可留空")
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(59)
      );

  const commands = [
    new SlashCommandBuilder()
      .setName("wt")
      .setDescription("WorkTime Bot 指令")
      .addSubcommand((sub) =>
        sub.setName("bank").setDescription("開啟 Hizu Jin 信託商業銀行")
      )
      .addSubcommand((sub) =>
        sub.setName("voice").setDescription("查看語音在線時長排行榜")
      )
      .addSubcommandGroup((group) =>
        group
          .setName("bank-admin")
          .setDescription("銀行 Debug 管理指令")
          .addSubcommand((sub) =>
            sub
              .setName("set-rate")
              .setDescription("設定銀行利率範圍")
              .addNumberOption((option) =>
                option
                  .setName("min-rate")
                  .setDescription("最低利率，例如 0.5")
                  .setRequired(true)
              )
              .addNumberOption((option) =>
                option
                  .setName("max-rate")
                  .setDescription("最高利率，例如 1")
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("info")
              .setDescription("查詢指定用戶貸款狀態")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("clear-loan")
              .setDescription("取消指定用戶進行中的貸款")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("set-paid")
              .setDescription("設定指定用戶貸款已繳期數")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("paid-installments")
                  .setDescription("已繳期數")
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("add-loan")
              .setDescription("替指定用戶建立測試貸款")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("貸款金額")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("installments")
                  .setDescription("分期期數，最多72期")
                  .setRequired(true)
              )
          )
      ),

    new SlashCommandBuilder()
      .setName("wt-admin")
      .setDescription("WorkTime Bot 管理員指令")
      .addSubcommandGroup((group) =>
        group
          .setName("worktime")
          .setDescription("管理工作時間")
          .addSubcommand((sub) =>
            timeOptions(
              sub
                .setName("add")
                .setDescription("增加指定用戶工作時間")
                .addUserOption((option) =>
                  option
                    .setName("user")
                    .setDescription("指定用戶")
                    .setRequired(true)
                )
            )
          )
          .addSubcommand((sub) =>
            timeOptions(
              sub
                .setName("reduce")
                .setDescription("減少指定用戶工作時間")
                .addUserOption((option) =>
                  option
                    .setName("user")
                    .setDescription("指定用戶")
                    .setRequired(true)
                )
            )
          )
          .addSubcommand((sub) =>
            sub
              .setName("clear")
              .setDescription("清除指定用戶工作時間")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addStringOption((option) =>
                option
                  .setName("confirm")
                  .setDescription("請輸入 YES 確認")
                  .setRequired(true)
              )
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName("mood")
          .setDescription("管理工作心情")
          .addSubcommand((sub) =>
            sub
              .setName("add")
              .setDescription("增加指定用戶心情指數")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("增加數量")
                  .setRequired(true)
                  .setMinValue(1)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("reduce")
              .setDescription("減少指定用戶心情指數")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("減少數量")
                  .setRequired(true)
                  .setMinValue(1)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("clear")
              .setDescription("清除指定用戶心情指數")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addStringOption((option) =>
                option
                  .setName("confirm")
                  .setDescription("請輸入 YES 確認")
                  .setRequired(true)
              )
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName("coin")
          .setDescription("管理金幣")
          .addSubcommand((sub) =>
            sub
              .setName("add")
              .setDescription("增加指定用戶金幣")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("增加金幣數量")
                  .setRequired(true)
                  .setMinValue(1)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("reduce")
              .setDescription("減少指定用戶金幣")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addIntegerOption((option) =>
                option
                  .setName("amount")
                  .setDescription("減少金幣數量")
                  .setRequired(true)
                  .setMinValue(1)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("clear")
              .setDescription("清除指定用戶金幣")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
              .addStringOption((option) =>
                option
                  .setName("confirm")
                  .setDescription("請輸入 YES 確認")
                  .setRequired(true)
              )
          )
      )
      .addSubcommandGroup((group) =>
        group
          .setName("force")
          .setDescription("強制上下班")
          .addSubcommand((sub) =>
            sub
              .setName("start")
              .setDescription("強制指定用戶上班")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
          )
          .addSubcommand((sub) =>
            sub
              .setName("end")
              .setDescription("強制指定用戶下班")
              .addUserOption((option) =>
                option
                  .setName("user")
                  .setDescription("指定用戶")
                  .setRequired(true)
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("panel-refresh")
          .setDescription("立即刷新 Panel，並設定每小時固定刷新時間")
          .addIntegerOption((option) =>
            option
              .setName("minute")
              .setDescription("每小時第幾分刷新，0~59")
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(59)
          )
          .addIntegerOption((option) =>
            option
              .setName("second")
              .setDescription("第幾秒刷新，0~59，預設 0")
              .setRequired(false)
              .setMinValue(0)
              .setMaxValue(59)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("voice-clear")
          .setDescription("清除指定用戶目前語音在線暫存紀錄")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("指定用戶")
              .setRequired(true)
          )
      ),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });

  console.log("Slash Command 註冊完成。");
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
  const container = new ContainerBuilder()
    .setAccentColor(0x66c5eb)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "### 💼 命苦上班打工人系統已成功部屬",
          "### <:SPACE:1506460111856468070> 第 1 頁：上下班功能頁",
        ].join("\n")
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_start")
      .setLabel("開始上班")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_end")
      .setLabel("完成下班")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_more")
      .setLabel("其他功能")
      .setEmoji("📂")
      .setStyle(ButtonStyle.Secondary)
  )
);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function getPanelMore() {
  const container = new ContainerBuilder()
    .setAccentColor(0x66c5eb)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "### 💼 命苦上班打工人系統已成功部屬",
          "### <:SPACE:1506460111856468070> 第 2 頁：更多功能頁",
        ].join("\n")
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("wt_query")
      .setLabel("上班查詢")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_status")
      .setLabel("我的狀態")
      .setEmoji("👤")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_rank")
      .setLabel("工時排行")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("wt_panel_main")
      .setLabel("返回面板")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary)
  )
);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
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

function calculateNextFixedPanelRefreshAt(date = new Date()) {
  const next = new Date(date);

  next.setMinutes(panelRefreshFixedMinute);
  next.setSeconds(panelRefreshFixedSecond);
  next.setMilliseconds(0);

  if (next.getTime() <= date.getTime()) {
    next.setHours(next.getHours() + 1);
  }

  return next.getTime();
}

function scheduleNextPanelRefresh() {
  if (panelRefreshTimer) {
    clearTimeout(panelRefreshTimer);
  }

  if (panelRefreshMode === "fixed") {
    panelNextRefreshAt = calculateNextFixedPanelRefreshAt();
  } else {
    panelNextRefreshAt = Date.now() + panelRefreshIntervalMs;
  }

  const delayMs = Math.max(1000, panelNextRefreshAt - Date.now());

  panelRefreshTimer = setTimeout(async () => {
    try {
      await refreshPanelChannel();
    } catch (error) {
      console.error("自動刷新面板時發生錯誤：", error);
    } finally {
      scheduleNextPanelRefresh();
    }
  }, delayMs);
}

function startPanelRefreshTimer() {
  scheduleNextPanelRefresh();
}

async function resetPanelRefreshTimerAndRunNow() {
  await refreshPanelChannel();
  scheduleNextPanelRefresh();
}

async function setFixedPanelRefreshTimeAndRunNow(minute, second = 0) {
  panelRefreshMode = "fixed";
  panelRefreshFixedMinute = minute;
  panelRefreshFixedSecond = second;

  await refreshPanelChannel();
  scheduleNextPanelRefresh();
}

function getPanelRefreshRemainingText() {
  if (!panelNextRefreshAt) {
    return "目前尚未啟動面板自動刷新計時器。";
  }

  const remainingMs = Math.max(0, panelNextRefreshAt - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);

  if (panelRefreshMode === "fixed") {
    return `距離下一次面板清空與重發還剩：${formatTime(
      totalSeconds
    )}\n目前固定刷新時間：每小時 ${panelRefreshFixedMinute} 分 ${panelRefreshFixedSecond} 秒`;
  }

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
      text: "你的上班紀錄已經超過 24 小時了，這次不計算ㄛ～",
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
      CREATE TABLE IF NOT EXISTS active_voice_sessions (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        channel_id TEXT,
        start_time BIGINT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_totals (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        total_seconds BIGINT DEFAULT 0,
        coins BIGINT DEFAULT 0,
        updated_at BIGINT
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_loans (
        loan_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT,
        principal BIGINT NOT NULL,
        interest_rate NUMERIC(8, 4) NOT NULL,
        total_interest BIGINT NOT NULL,
        paid_interest BIGINT DEFAULT 0,
        total_repayment BIGINT NOT NULL,
        installment_count INT NOT NULL,
        paid_installments INT DEFAULT 0,
        paid_amount BIGINT DEFAULT 0,
        monthly_payment BIGINT NOT NULL,
        next_payment_day INT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_loan_payments (
        payment_id SERIAL PRIMARY KEY,
        loan_id INT NOT NULL,
        user_id TEXT NOT NULL,
        paid_installments INT NOT NULL,
        paid_amount BIGINT NOT NULL,
        interest_paid BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      );
    `);

    await pool.query(`
      INSERT INTO bank_settings (setting_key, setting_value)
      VALUES ('loan_min_rate', '0.5')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    await pool.query(`
      INSERT INTO bank_settings (setting_key, setting_value)
      VALUES ('loan_max_rate', '1')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    await loadActiveSessions();
    await loadActiveVoiceSessions();

    console.log("資料表確認完成");

    await registerSlashCommands();

    await checkAndDistributeRankingRewards();
    startRankingRewardTimer();

    await refreshPanelChannel();
    startPanelRefreshTimer();
  } catch (error) {
    console.error("資料表確認失敗：", error);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.user.id;
    const username = member.user.username;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // 進入語音頻道
    if (!oldChannelId && newChannelId) {
      const startTime = Date.now();

      voiceStartTimes.set(userId, {
        username,
        channelId: newChannelId,
        startTime,
      });

      await saveActiveVoiceSession(userId, username, newChannelId, startTime);

      console.log(`${username} 進入語音頻道，開始累積語音在線時間。`);
      return;
    }

    // 離開語音頻道
    if (oldChannelId && !newChannelId) {
      const session = voiceStartTimes.get(userId);

      if (!session) {
        await removeActiveVoiceSession(userId);
        return;
      }

      const voiceSeconds = Math.floor((Date.now() - session.startTime) / 1000);
      const earnedCoins = await addVoiceTimeAndReward(
        userId,
        username,
        voiceSeconds
      );

      voiceStartTimes.delete(userId);
      await removeActiveVoiceSession(userId);

      console.log(
        `${username} 離開語音頻道，本次在線 ${formatTime(
          voiceSeconds
        )}，獲得 ${earnedCoins} 金幣。`
      );

      return;
    }

    // 切換語音頻道，不重置時間，只更新 channel_id
    if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
      const session = voiceStartTimes.get(userId);

      if (session) {
        session.channelId = newChannelId;
        voiceStartTimes.set(userId, session);
        await updateActiveVoiceChannel(userId, newChannelId);
      } else {
        const startTime = Date.now();

        voiceStartTimes.set(userId, {
          username,
          channelId: newChannelId,
          startTime,
        });

        await saveActiveVoiceSession(userId, username, newChannelId, startTime);
      }

      console.log(`${username} 切換語音頻道，語音在線時間繼續累積。`);
    }
  } catch (error) {
    console.error("處理語音狀態更新時發生錯誤：", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.inGuild() && !isAllowedChannel(interaction.channelId)) {
        await interaction.reply({
          content: "這個頻道不能使用此指令。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.commandName === "wt-admin") {
        await handleWtAdminCommand(interaction);
        return;
      }

      if (interaction.commandName !== "wt") return;

      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();

      if (group === "bank-admin") {
        await handleBankAdminCommand(interaction);
        return;
      }

      if (sub === "bank") {
        const embed = await getBankEmbed(interaction.user);

        await interaction.reply({
          embeds: [embed],
          components: [getBankMainButtons()],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === "voice") {
        const embed = await getVoiceRankingEmbed();

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "wt_bank_borrow_modal") {
        await handleLoanApplicationSubmit(interaction);
        return;
      }

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "wt_bank_repay_select") {
        const installments = Number(interaction.values[0]);
        const loan = await getActiveLoan(interaction.user.id);

        if (!loan) {
          await interaction.update({
            embeds: [getNoActiveLoanEmbed(interaction.user)],
            components: [getBackToBankButton()],
          });
          return;
        }

        pendingRepayments.set(interaction.user.id, {
          loanId: loan.loan_id,
          installments,
        });

        const embed = await getRepayConfirmEmbed(
          interaction.user,
          loan,
          installments
        );

        await interaction.update({
          embeds: [embed],
          components: [getRepayConfirmButtons()],
        });
        return;
      }

      return;
    }

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

    if (interaction.customId.startsWith("wt_bank")) {
      const user = interaction.user;

      if (interaction.customId === "wt_bank_back") {
        const embed = await getBankEmbed(user);

        await interaction.update({
          embeds: [embed],
          components: [getBankMainButtons()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_borrow") {
        await interaction.showModal(createLoanModal());
        return;
      }

      if (interaction.customId === "wt_bank_repay") {
        const loan = await getActiveLoan(user.id);

        if (!loan) {
          await interaction.update({
            embeds: [getNoActiveLoanEmbed(user)],
            components: [getBackToBankButton()],
          });
          return;
        }

        const remainingInstallments =
          Number(loan.installment_count) - Number(loan.paid_installments);

        if (remainingInstallments <= 0) {
          await interaction.update({
            embeds: [getNoActiveLoanEmbed(user)],
            components: [getBackToBankButton()],
          });
          return;
        }

        await interaction.update({
          embeds: [getRepaySelectEmbed(user, loan)],
          components: [createRepaySelect(remainingInstallments), getBackToBankButton()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_query") {
        const loan = await getActiveLoan(user.id);
        const embed = getLoanCaseEmbed(user, loan);

        await interaction.update({
          embeds: [embed],
          components: loan ? [getLoanCaseButtons()] : [getBackToBankButton()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_accept_loan") {
        const application = pendingLoanApplications.get(user.id);

        if (!application) {
          await interaction.update({
            embeds: [
              getRejectedLoanEmbed(user, "找不到您的貸款申請資料，請重新申請。"),
            ],
            components: [getBankBackButtons()],
          });
          return;
        }

        const activeLoan = await getActiveLoan(user.id);

        if (activeLoan) {
          pendingLoanApplications.delete(user.id);

          await interaction.update({
            embeds: [
              getRejectedLoanEmbed(user, "您目前已有進行中的貸款案件。"),
            ],
            components: [getBankBackButtons()],
          });
          return;
        }

        await createLoan(user.id, user.username, application);
        pendingLoanApplications.delete(user.id);

        const embed = new EmbedBuilder()
          .setTitle("貸款撥款成功")
          .setDescription(
            `本行已撥款 🪙 ${formatCoins(application.principal)} 至您的錢包。`
          )
          .setColor(0x2ecc71)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [getBackToBankButton()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_reject_loan") {
        pendingLoanApplications.delete(user.id);

        const embed = new EmbedBuilder()
          .setTitle("您已取消本次貸款申請")
          .setColor(0x95a5a6)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [getBackToBankButton()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_cancel_repay") {
        pendingRepayments.delete(user.id);

        const embed = new EmbedBuilder()
          .setTitle("您已取消本次還款")
          .setColor(0x95a5a6)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [getBackToBankButton()],
        });
        return;
      }

      if (interaction.customId === "wt_bank_confirm_repay") {
        const repayment = pendingRepayments.get(user.id);

        if (!repayment) {
          await interaction.update({
            embeds: [
              new EmbedBuilder()
                .setTitle("找不到還款資料")
                .setDescription("請重新操作還款流程。")
                .setColor(0xe74c3c)
                .setThumbnail(user.displayAvatarURL({ size: 256 }))
                .setTimestamp(),
            ],
            components: [getBackToBankButton()],
          });
          return;
        }

        const loan = await getActiveLoan(user.id);

        if (!loan || Number(loan.loan_id) !== Number(repayment.loanId)) {
          pendingRepayments.delete(user.id);

          await interaction.update({
            embeds: [getNoActiveLoanEmbed(user)],
            components: [getBackToBankButton()],
          });
          return;
        }

        const result = await repayLoan(user, loan, repayment.installments);
        pendingRepayments.delete(user.id);

        const embed = new EmbedBuilder()
          .setTitle(result.ok ? "還款成功" : "還款失敗")
          .setDescription(result.text)
          .setColor(result.ok ? 0x2ecc71 : 0xe74c3c)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [getBackToBankButton()],
        });
        return;
      }
    }

    if (!isAllowedChannel(interaction.channelId)) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;

    if (interaction.customId === "wt_more") {
      const panel = getPanelMore();

      await interaction.update({
        components: panel.components,
      });

      return;
    }

    if (interaction.customId === "wt_panel_main") {
      const panel = getPanel();

      await interaction.update({
        components: panel.components,
      });

      return;
    }

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
          "📖 指令：\n`!面板`\n`!查詢`\n`!排行榜`\n`!我的狀態`\n`!wt add worktime @人 秒數` [僅提供開發Debug使用]\n`!wt remove worktime @人` [僅提供開發Debug使用]\n`!wt add workmood @人 指數` [僅提供開發Debug使用]\n`!wt remove workmood @人` [僅提供開發Debug使用]\n`!wt add coin @人 數量` [僅提供開發Debug使用]\n`!wt remove coin @人` [僅提供開發Debug使用]\n`!強制上班 @人` [僅提供開發Debug使用]\n`!強制下班 @人` [僅提供開發Debug使用]\n`!wt refresh panel` [僅提供開發Debug使用]\n`/wt bank`\n`/wt bank-admin ...` [僅提供開發Debug使用]",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    console.error("處理互動時發生錯誤：", error);
  }
});

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

    if (c === "!wt voice") {
      const embed = await getVoiceRankingEmbed();
      msg.reply({ embeds: [embed] });
      return;
    }

    if (c.startsWith("!wt voice clear")) {
      if (!isAdmin(msg.member)) {
        msg.reply("你沒有權限使用這個指令。");
        return;
      }

      const u = msg.mentions.users.first();

      if (!u) {
        msg.reply("格式錯誤：`!wt voice clear @人`");
        return;
      }

      voiceStartTimes.delete(u.id);
      await removeActiveVoiceSession(u.id);

      msg.reply(`已清除 ${u.username} 目前進行中的語音在線紀錄。`);
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