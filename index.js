require("dotenv").config();

const { Pool } = require("pg");
const { Client, GatewayIntentBits, Events } = require("discord.js");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const workStartTimes = new Map();

const workReplies = [
  "又是辛勤工作的一天呢！上班要加油窩～ :smiling_face_with_3_hearts: ！",
  "努力奮鬥打工人！！打工才是人上人！！上班路上小心～",
  "今天也是超級打工人喔！加油歐力給～！",
  "上班辛苦啦～ 今天也要平安順利的上班ㄛ！",
  "打工魂燃燒起來！ 今天也是適合打工的日子呢！",
  "出勤打工啦！ 今天也要賺飽飽～",
  "工作開始！記得補水，不要累壞自己ㄛ～",
  "又到了打工時間，祝你今天順順利利！",
  "今天也準時上班打工，太優秀了吧！",
  "加油加油！今日打工人正式上線！",
];

const offWorkReplies = [
  "辛苦啦~ :smiling_face_with_3_hearts: 今天又工作了 {time} 呢，值得嘉獎！",
  "終於下班了！今天撐了 {time}，太猛了吧🔥",
  "下班快樂！今天努力了 {time}，該好好休息了😴",
  "收工啦～今天整整 {time}，給你一個大大的讚👍",
  "辛苦的打工人下班啦！今天工作了 {time}，真的很棒！",
  "今日工時 {time}，恭喜你成功存活到下班！",
  "下班打卡成功！今天努力了 {time}，快去休息吧～",
  "太強了，今天又奮鬥了 {time}，值得吃點好料！",
  "今天的工作時間是 {time}，辛苦你啦～",
  "任務完成！本次工作時長 {time}，打工人可以退場啦！",
];

function getRandomReply(replies) {
  return replies[Math.floor(Math.random() * replies.length)];
}

function formatSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}小時${minutes}分${seconds}秒`;
}

function formatWorkTime(ms) {
  return formatSeconds(Math.floor(ms / 1000));
}

function isAllowedChannel(channelId) {
  if (process.env.CHANNEL_IDS) {
    const allowedChannels = process.env.CHANNEL_IDS.split(",").map(id => id.trim());
    return allowedChannels.includes(channelId);
  }

  return channelId === process.env.CHANNEL_ID;
}

async function addWorkSeconds(userId, username, seconds) {
  await pool.query(
    `
    INSERT INTO work_totals (user_id, username, total_seconds)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      total_seconds = work_totals.total_seconds + $3,
      username = $2
    `,
    [userId, username, seconds]
  );
}

client.once(Events.ClientReady, async () => {
  console.log(`機器人已上線：${client.user.tag}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_totals (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      total_seconds BIGINT DEFAULT 0
    );
  `);

  console.log("資料表確認完成");
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!isAllowedChannel(message.channel.id)) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const now = Date.now();

    // ===== 指令說明 =====
    if (content === "!幫助") {
      const helpText = `
📖 **WorkTime Bot 指令說明**

**!幫助**
顯示所有指令與使用方式。

**!查詢**
查詢目前所有上班中的打工人，以及已經上班多久ㄌ。

**!排行榜**
查看打工人總工時排行榜。

**!wt add worktime @打工人 秒數**
[僅提供開發 DEBUG 使用]
直接替指定打工人增加「總工時」，會保存到資料庫。

範例：
\`!wt add worktime @HizuJin 3600\`

代表幫 @HizuJin 增加 3600 秒，也就是 1 小時。

**!強制下班 @打工人**
強制將指定打工人下班，並將本次工時加入總工時。

範例：
\`!強制下班 @HizuJin\`

📌 **一般觸發詞**

只要訊息包含 **上班**：
Bot 會記錄你的上班開始時間，並隨機給你加油打氣！

只要訊息包含 **下班**：
Bot 會計算你的工作時間，加入總工時，並隨機回覆下班辛苦訊息～
`;

      message.reply(helpText);
      return;
    }

    // ===== 查詢目前上班中 =====
    if (content === "!查詢") {
      if (workStartTimes.size === 0) {
        message.reply("目前沒有任何打工人在上班ㄛ～");
        return;
      }

      let result = "📋 目前上班中的打工人：\n";

      for (const [targetUserId, startTime] of workStartTimes) {
        const user = await client.users.fetch(targetUserId);
        const timeText = formatWorkTime(Date.now() - startTime);

        result += `👤 ${user.username}：已上班 ${timeText}\n`;
      }

      message.reply(result);
      return;
    }

    // ===== 總工時排行榜 =====
    if (content === "!排行榜") {
      const result = await pool.query(`
        SELECT username, total_seconds
        FROM work_totals
        ORDER BY total_seconds DESC
        LIMIT 10
      `);

      if (result.rows.length === 0) {
        message.reply("目前沒有排行榜資料");
        return;
      }

      let text = "🏆 打工人總工時排行榜\n\n";

      result.rows.forEach((row, index) => {
        text += `${index + 1}. ${row.username}：${formatSeconds(Number(row.total_seconds))}\n`;
      });

      message.reply(text);
      return;
    }

    // ===== 手動增加總工時 =====
    if (content.startsWith("!wt add worktime")) {
      const args = content.split(" ");
      const targetUser = message.mentions.users.first();
      const seconds = Number(args[4]);

      if (args.length < 5 || !targetUser || isNaN(seconds)) {
        message.reply("格式錯誤！用法：!wt add worktime @打工人 秒數");
        return;
      }

      await addWorkSeconds(targetUser.id, targetUser.username, seconds);

      message.reply(`已為打工人 ${targetUser.username} 增加 ${seconds} 秒總工時`);
      return;
    }

    // ===== 強制下班 =====
    if (content.startsWith("!強制下班")) {
      const targetUser = message.mentions.users.first();

      if (!targetUser) {
        message.reply("格式錯誤！用法：!強制下班 @打工人");
        return;
      }

      const startTime = workStartTimes.get(targetUser.id);

      if (!startTime) {
        message.reply(`打工人 ${targetUser.username} 目前沒有上班紀錄ㄛ！`);
        return;
      }

      const diffMs = now - startTime;

      if (diffMs > 24 * 60 * 60 * 1000) {
        workStartTimes.delete(targetUser.id);
        message.reply(`打工人 ${targetUser.username} 的上班紀錄已經超過 24 小時，這次不計算喔～`);
        return;
      }

      const totalSeconds = Math.floor(diffMs / 1000);
      const timeText = formatSeconds(totalSeconds);

      await addWorkSeconds(targetUser.id, targetUser.username, totalSeconds);
      workStartTimes.delete(targetUser.id);

      message.reply(
        `已強制將打工人 ${targetUser.username} 下班，本次工作時間為 ${timeText}，並已加入總工時。`
      );
      return;
    }

    // ===== 觸發「上班」=====
    if (content.includes("上班")) {
      workStartTimes.set(userId, now);
      message.reply(`${message.author} ${getRandomReply(workReplies)}`);
      return;
    }

    // ===== 觸發「下班」=====
    if (content.includes("下班")) {
      const startTime = workStartTimes.get(userId);

      if (!startTime) {
        message.reply(`${message.author} 你今天好像還沒有說上班喔～`);
        return;
      }

      const diffMs = now - startTime;

      if (diffMs > 24 * 60 * 60 * 1000) {
        workStartTimes.delete(userId);
        message.reply(`${message.author} 你的上班紀錄已經超過 24 小時了，這次不計算喔～`);
        return;
      }

      const totalSeconds = Math.floor(diffMs / 1000);
      const timeText = formatSeconds(totalSeconds);

      await addWorkSeconds(userId, message.author.username, totalSeconds);

      const finalReply = getRandomReply(offWorkReplies).replace("{time}", timeText);

      message.reply(`${message.author} ${finalReply}`);

      workStartTimes.delete(userId);
    }
  } catch (error) {
    console.error("處理訊息時發生錯誤：", error);
    message.reply("系統發生錯誤，請稍後再試。");
  }
});

client.login(process.env.TOKEN);