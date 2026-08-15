const http = require('http');
const nodemailer = require("nodemailer");
const imap = require("imap");

const getTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.QQ_EMAIL,
      pass: process.env.QQ_AUTH_CODE
    }
  });
};

async function handleMCP(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  };

  // 长连接兜底超时，90秒主动关闭
  const timeout = setTimeout(() => {
    try { res.end(); } catch(e){}
  }, 90000);

  req.on("close", () => clearTimeout(timeout));

  if (req.method === "GET") {
    sendEvent({
      jsonrpc: "2.0",
      id: null,
      result: {
        protocolVersion: "0.1.0",
        capabilities: {
          tools: {}
        },
        tools: [
          {
            name: "send_mail",
            description: "给自己的QQ邮箱发送一条消息，用来传递剧情对话",
            inputSchema: {
              type: "object",
              properties: {
                subject: { type: "string", description: "邮件标题" },
                content: { type: "string", description: "邮件正文内容" }
              },
              required: ["subject", "content"]
            }
          },
          {
            name: "check_mail",
            description: "读取最新一封未读邮件，获取对方发来的剧情消息",
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      }
    });
    return;
  }

  if (req.method !== "POST") {
    res.end();
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    sendEvent({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON解析失败" } });
    return;
  }
  const { id, method, params } = payload;

  try {
    if (method === "tools/call") {
      const toolName = params.name;
      const args = params.arguments;
      if (toolName === "send_mail") {
        const transporter = getTransporter();
        await transporter.sendMail({
          from: process.env.QQ_EMAIL,
          to: process.env.QQ_EMAIL,
          subject: args.subject,
          html: args.content
        });
        sendEvent({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "发送成功" }] } });
      } else if (toolName === "check_mail") {
        const imapConn = new imap({
          host: "imap.qq.com",
          port: 993,
          tls: true,
          user: process.env.QQ_EMAIL,
          password: process.env.QQ_AUTH_CODE
        });
        let latestMailText = "暂无新邮件";
        let replied = false;
        const safeReply = (msg) => {
          if(replied) return;
          replied = true;
          sendEvent({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: msg }] } });
          imapConn.end();
        };

        imapConn.on("error", (err) => {
          safeReply("IMAP连接异常：" + err.message);
        });

        imapConn.on("ready", () => {
          imapConn.openBox("INBOX", false, (err, box) => {
            if (err) {
              safeReply("打开收件箱失败：" + err.message);
              return;
            }
            imapConn.search(["UNSEEN"], (err, uids) => {
              if (err || !uids || uids.length === 0) {
                safeReply(latestMailText);
                return;
              }
              const latestUid = uids[uids.length - 1];
              const fetch = imapConn.fetch(latestUid, { bodies: "" });
              fetch.on("message", (msg) => {
                msg.on("body", (stream) => {
                  let buff = "";
                  stream.on("data", d => buff += d.toString("utf8"));
                  stream.on("end", () => {
                    latestMailText = buff;
                  });
                });
              });
              fetch.on("end", () => {
                safeReply(latestMailText);
              });
              fetch.on("error",(err)=>{
                safeReply("读取邮件失败：" + err.message);
              })
            });
          });
        });
        imapConn.connect();
      }
    }
  } catch (e) {
    sendEvent({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
  }
}

const server = http.createServer((req, res) => {
  if(req.url === '/'){
    res.end('MCP server running');
  }else if(req.url.startsWith('/mcp')){
    handleMCP(req, res);
  }else{
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Server started');
});
