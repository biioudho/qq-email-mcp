const http = require('http');
const server = http.createServer((req, res) => {
  res.end('MCP server running');
});
server.listen(process.env.PORT || 3000, () => {
  console.log('Server started');
});

// ==========下面粘贴你原来全部的mcp.js原有代码==========

const nodemailer = require("nodemailer");

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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep‑alive");

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

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
  const payload = JSON.parse(body);
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
        const imap = require("imap");
        const imapConn = new imap({
          host: "imap.qq.com",
          port: 993,
          tls: true,
          user: process.env.QQ_EMAIL,
          password: process.env.QQ_AUTH_CODE
        });
        let latestMailText = "暂无新邮件";
        imapConn.on("ready", () => {
          imapConn.openBox("INBOX", false, (err, box) => {
            if (err) { imapConn.end(); return; }
            imapConn.search(["UNSEEN"], (err, uids) => {
              if (err || uids.length === 0) { imapConn.end(); return; }
              const latestUid = uids[uids.length - 1];
              const fetch = imapConn.fetch(latestUid, { bodies: "" });
              fetch.on("message", (msg) => {
                msg.on("body", (stream) => {
                  let buff = "";
                  stream.on("data", d => buff += d.toString("utf8"));
                  stream.on("end", () => {
                    latestMailText = buff;
                    imapConn.end();
                  });
                });
              });
              fetch.on("end", () => {
                sendEvent({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: latestMailText }] } });
              });
            });
          });
        });
        imapConn.connect();
      }
    }
  } catch (e) {
    sendEvent({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
  }
};
