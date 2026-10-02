# 私人口语 API 后端

本目录不能在 GitHub Pages 执行。需要 Node 22+ 服务及 HTTPS 反向代理。

服务器环境变量：OPENAI_API_KEY、IELTS_ACCESS_TOKEN（随机口令至少 24 字符）、ALLOWED_ORIGIN=https://hananhdang.github.io、可选 PORT/GPT_TEXT_MODEL/GPT_AUDIO_MODEL。
运行：`node server.mjs`。默认仅监听 127.0.0.1:8787，反向代理将 HTTPS /api/ielts 转发到它。

在网站设置页填写 HTTPS 后端地址和访问口令；不要填 OpenAI API Key。OpenAI 密钥仅存在服务器环境变量。访问口令只保留浏览器会话；API 每小时最多 40 次，还应在 OpenAI 项目中设置预算并在代理层配置限流。录音请求体最多 16 MB，不保存音频、不写请求内容日志。

接口 POST /api/ielts，Authorization: Bearer <访问口令>，JSON action speech/chat/feedback。
生成 MP3 使用 gpt-4o-mini-tts；聊天默认 gpt-4.1-mini；实际音频反馈默认 gpt-audio-1.5。模型可用性及费用由服务账号决定。发音反馈属于练习建议，不是官方分数或精确音素评测。

尚未提供后端账号/部署权限，因此未部署、未调用付费 API，真实录音反馈未验证。
