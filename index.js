require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 記錄使用者上班時間
const workStartTimes = new Map();

const workReplies = [
  "又是辛勤工作的一天呢！上班要加油窩～ :smiling_face_with_3_hearts: ！",
  "努力奮鬥打工人！！打工才是人上人！！上班路上小心～",
  "今天也是超級打工人喔！加油歐力給～！",
];

const offWorkReplies = [
  "辛苦啦~ :smiling_face_with_3_hearts: 今天又工作了 {time} 呢，值得嘉獎！",
  "終於下班了！今天撐了 {time}，太猛了吧🔥",
  "下班快樂！今天努力了 {time}，該好好休息了😴",
  "收工啦～今天整整 {time}，給你一個大大的讚👍",
];

client.once("ready", () => {
  console.log(`機器人已上線：${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== process.env.CHANNEL_ID) return;

  const content = message.content;
  const userId = message.author.id;
  const now = Date.now();

  // ===== 查詢全部人 =====
  if (content.trim() === "!查詢") {
    if (workStartTimes.size === 0) {
      message.reply("目前沒有任何人上班中");
      return;
    }

    let result = "📋 目前上班中的人：\n";

    for (const [targetUserId, startTime] of workStartTimes) {
      const user = await client.users.fetch(targetUserId);

      const diffMs = Date.now() - startTime;
      const totalSeconds = Math.floor(diffMs / 1000);

      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      result += `👤 ${user.username}：已上班 ${hours}小時${minutes}分${seconds}秒\n`;
    }

    message.reply(result);
    return;
  }
    // ===== 手動增加工時 =====
  if (content.startsWith("!wt add worktime")) {
    const args = content.split(" ");

    // 格式錯誤
    if (args.length < 5) {
      message.reply("格式錯誤！用法：!wt add worktime @用戶 秒數");
      return;
    }

    const targetUser = message.mentions.users.first();
    const seconds = parseInt(args[4]);

    if (!targetUser || isNaN(seconds)) {
      message.reply("請正確標記打工人並輸入秒數！");
      return;
    }

    const targetUserId = targetUser.id;
    const currentStartTime = workStartTimes.get(targetUserId);

    if (!currentStartTime) {
      message.reply("這位打工人目前沒有上班的紀錄ㄛ！");
      return;
    }

    // 👉 核心邏輯：把時間往前推 = 增加工時
    const newStartTime = currentStartTime - (seconds * 1000);

    workStartTimes.set(targetUserId, newStartTime);

    message.reply(
      `已為打工人 ${targetUser.username} 增加 ${seconds} 秒工時`
    );

    return;
  }
  // 觸發「上班」
  if (content.includes("上班")) {
    workStartTimes.set(userId, now);

    const randomReply =
      workReplies[Math.floor(Math.random() * workReplies.length)];

    message.reply(`${message.author} ${randomReply}`);
    return;
  }

  // 觸發「下班」
  if (content.includes("下班")) {
    const startTime = workStartTimes.get(userId);

    if (!startTime) {
      message.reply(`${message.author} 你今天好像還沒有說上班喔～`);
      return;
    }

    const diffMs = now - startTime;
    const diffHours = diffMs / (1000 * 60 * 60);

    // 超過 24 小時不計算
    if (diffHours > 24) {
      workStartTimes.delete(userId);
      message.reply(
        `${message.author} 你的上班紀錄已經超過 24 小時了，這次不計算喔～`
      );
      return;
    }
    
    const totalSeconds = Math.floor(diffMs / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const timeText = `${hours}小時${minutes}分${seconds}秒`;

    const randomReply =
      offWorkReplies[Math.floor(Math.random() * offWorkReplies.length)];

    const finalReply = randomReply.replace("{time}", timeText);

    message.reply(`${message.author} ${finalReply}`);

    // 下班後清除這次上班紀錄
    workStartTimes.delete(userId);
  }
});

client.login(process.env.TOKEN);