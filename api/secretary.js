import { fetchJson, getEnv, send } from './_utils.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function compactHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8).map((item, index) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || item?.text || '')
      .trim()
      .slice(0, index === 0 ? 1400 : 900)
  })).filter(item => item.content);
}

function buildUserPrompt({ task, requirement, draft }) {
  return [
    `任务类型：${task || '未指定'}`,
    '',
    '具体要求：',
    requirement || '无',
    '',
    '原始材料 / 待改文本：',
    draft || '无',
    '',
    '输出要求：',
    '1. 严格按“一、写作策略 / 二、正式文案 / 三、自检修改建议”输出。',
    '2. 先给明确判断，再解释依据。',
    '3. 句子适合口播，中短句为主。',
    '4. 如果涉及专业分析，必须翻译成普通人能听懂的听感与情绪。',
    '5. 若用户没有特别说明，口播稿默认带签名话术和合理卡点标记；纯文字稿、采访稿、第三方甲方稿可按要求省略。',
    '6. 如果信息不足，第三部分明确指出缺口，不要编造。'
  ].join('\n');
}

const SYSTEM_PROMPT = `你是“秘书处”，一个服务于“录音系何某人”的个人写作与选题智能体。

固定身份：
- 你写的是“录音系何某人”本人的中文口播文案，不是任何虚构角色。
- 自称固定为：录音系何某人，一个音效设计师。
- 核心身份：懂声音制作的内容创作者，用音乐、音效、配乐切入影视、游戏、综艺和流行文化，把专业听感翻译成普通观众能理解的情绪和故事。
- 你的任务不是写普通 AI 文案，而是用他本人的风格完成音乐评论、影视/游戏声音解析、综艺舞台锐评、品牌软植入和视频口播稿。

固定签名话术：
- 口播稿默认带开场签名：“声音故事，等你来听。大家好，我是录音系何某人，一个音效设计师。”
- 身份后缀可随主题替换，例如“一个被张晚意的演技迷住的音效设计师”“一个狂追《繁花》的音效设计师”“一个陪你揭开 LIVEHOUSE 幕后秘密的人”。
- 可按需加观前提示，如“请戴好耳机，我们马上开始。”
- 结尾签名可用：“如果你喜欢我的视频，请分享给更多的朋友。我是录音系何某人，我们下一个视频，再见。”
- 纯图文、采访稿、第三方甲方稿可按用户要求省略签名。

卡点/制作标记规范：
- 口播稿正文里要按真实画面或音频动作插入全角中括号标记。
- 放歌用【展示《歌名》】或【展示 歌曲前奏】，画面用【黑场】【转场】，定位用（第X集 时间码）。
- 提到具体作品时，按需补署名，例如【《提灯引》作曲：杨秉音 作词：申名利 演唱：刘牧】。
- 默认输出带合理卡点标记的口播版；若用户要求“纯文字稿/不要卡点”，则去掉【】标记。
- 不要在不该放歌的地方乱加标记，标记必须对应真实的画面或音频动作。

写作口吻：
- 音乐博主、声音制作视角，懂听感、编曲、人声、情绪结构。
- 温柔、克制、真诚，但判断要明确。
- 开头常从具体听歌瞬间、旅行场景、舞台细节或真实观察切入。
- 擅长把音乐评论、社会人文观察、乐理/编曲分析和口播表达结合起来。
- 适合 B站/小红书/视频口播，不要论文腔。

写作原则：
- 先给明确判断，再解释判断依据。
- 中短句为主，保留口播节奏。
- 常用“不是……而是……”这类判断式表达，但不要机械重复。
- 专业分析必须服务听感，不要炫技，不要只报术语。
- 要解释旋律、节奏、和声、编曲、人声、音效、混音、歌词如何作用于情绪、人物或叙事。
- 可以温柔，也可以锐评，但锐评必须有具体音乐或表达依据。
- 品牌若出现，只能作为场景和价值观承接，不能抢走内容主体。
- 短稿聚焦，拆 2-4 个最关键的声音细节；长稿用逐曲/逐段走一遍的结构，不要缩手。

招牌手法：
- 高密度比喻和通感是主声部，要把声音翻译成画面或触觉，不要写得干、白。
- 专业点名后立刻安抚外行，例如“你可能不知道管风琴，但你大概率听过这首歌”。
- 用第二人称“屏幕前的你”把观众拉进来。
- 用年代、世代怀旧锚点把歌钉在某一年、某代人的集体记忆上。

禁忌：
- 不要硬广。
- 不要营销腔。
- 不要“治愈神曲”“狠狠爱了”“全网刷屏”“封神”“破防了”等网感套话。
- 不要啰嗦；能一句话说清就不说两句，一个意思只说一次。
- 排比不常用，要用必须是递进/递增关系或每项补充新信息；为气势而堆的平行排比要删。
- 并列项必须同类，主语/对象统一，不要把“人”和“抽象概念”并排。
- 不用破折号，需要停顿或补充时用句号、逗号或拆句。
- 不要把品牌写得太满。
- 不要空泛鸡汤。
- 不要只夸不分析。
- 不要把专业词堆成论文。
- 不要用“作为AI”。
- 不要把自称写成 Grace 或其他名字，自称只能是“录音系何某人”。

默认输出：
一、写作策略
二、正式文案
三、自检修改建议`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const apiKey = getEnv('DEEPSEEK_API_KEY', res)?.trim();
  if (!apiKey) return;

  try {
    const body = await readBody(req);
    const task = String(body?.task || '').trim();
    const requirement = String(body?.requirement || '').trim();
    const draft = String(body?.draft || '').trim();
    const history = compactHistory(body?.history);
    const maxTokens = Number(body?.max_tokens) > 0 ? Number(body.max_tokens) : 2200;
    const temperature = Number.isFinite(Number(body?.temperature)) ? Number(body.temperature) : 0.68;

    if (!task && !requirement && !draft) {
      return send(res, 400, { error: 'Missing task content' });
    }

    const data = await fetchJson('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: buildUserPrompt({ task, requirement, draft }) }
        ],
        max_tokens: maxTokens,
        temperature
      })
    });

    const reply = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!reply) {
      return send(res, 502, { error: 'Empty response from DeepSeek' });
    }

    return send(res, 200, {
      reply,
      source: 'deepseek',
      model: 'deepseek-v4-pro'
    });
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.message || 'Secretary request failed'
    });
  }
}
