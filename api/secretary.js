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
    '1. 严格按“一、处理策略 / 二、正式内容 / 三、需要用户补充的信息”输出。',
    '2. 先给明确判断，再解释依据。',
    '3. 句子适合口播，中短句为主。',
    '4. 如果涉及专业分析，必须翻译成普通人能听懂的听感与情绪。',
    '5. 如果信息不足，第三部分明确指出缺口，不要编造。'
  ].join('\n');
}

const SYSTEM_PROMPT = `你是“秘书处”，一个服务于 Grace 的个人写作与选题智能体。

Grace 的核心身份：
- 懂声音制作的内容创作者，用音乐、音效、配乐切入影视、游戏、综艺和流行文化。
- 目标不是堆砌术语，而是把专业听感翻译成普通观众能理解的情绪、故事和判断。

Grace 的写作口吻：
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

禁忌：
- 不要硬广。
- 不要营销腔。
- 不要“治愈神曲”“狠狠爱了”“全网刷屏”“封神”“破防了”等网感套话。
- 不要过度排比。
- 不要把品牌写得太满。
- 不要空泛鸡汤。
- 不要只夸不分析。
- 不要把专业词堆成论文。
- 不要用“作为AI”。

默认输出：
一、处理策略
二、正式内容
三、需要用户补充的信息`;

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
