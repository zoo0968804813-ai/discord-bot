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

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== process.env.CHANNEL_ID) return;

  const content = message.content;
  const userId = message.author.id;
  const now = Date.now();

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

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // 秒數省略，分鐘數每 5 分鐘為一階
    // 0~5 分鐘 = 0 分鐘
    // 6~10 分鐘 = 5 分鐘
    // 11~15 分鐘 = 10 分鐘，以此類推
    const roundedMinutes = Math.floor((minutes - 1) / 5) * 5;
    const finalMinutes = roundedMinutes < 0 ? 0 : roundedMinutes;

    let timeText = "";

    if (hours > 0 && finalMinutes > 0) {
      timeText = `${hours}小時${finalMinutes}分鐘`;
    } else if (hours > 0) {
      timeText = `${hours}小時`;
    } else {
      timeText = `${finalMinutes}分鐘`;
    }

    const randomReply =
      offWorkReplies[Math.floor(Math.random() * offWorkReplies.length)];

    const finalReply = randomReply.replace("{time}", timeText);

    message.reply(`${message.author} ${finalReply}`);

    // 下班後清除這次上班紀錄
    workStartTimes.delete(userId);
  }
});

client.login(process.env.TOKEN);