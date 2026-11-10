import net from 'node:net';

/**
 * Minimal in-process SMTP server for tests: enough of RFC 5321 (EHLO, AUTH PLAIN/LOGIN, MAIL,
 * RCPT, DATA, RSET, NOOP, QUIT) for nodemailer to verify a connection and deliver messages.
 * Messages are kept in memory so tests can assert on what customers would actually receive.
 */
export type SinkMessage = { from: string; to: string[]; data: string };

export async function startSmtpSink(creds?: { user: string; pass: string }) {
  const messages: SinkMessage[] = [];
  /** When true, every MAIL FROM is answered with a temporary failure (simulates a mail-server outage). */
  let failing = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buf = '';
    let inData = false;
    let authStep: '' | 'user' | 'pass' = '';
    let authUser = '';
    let authed = !creds;
    let cur: SinkMessage = { from: '', to: [], data: '' };
    const send = (line: string) => socket.write(line + '\r\n');
    const checkPlain = (b64: string) => {
      const [, user, pass] = Buffer.from(b64, 'base64').toString('utf8').split('\0');
      return Boolean(creds) && user === creds!.user && pass === creds!.pass;
    };
    send('220 sink.test ESMTP');
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(cur);
            cur = { from: '', to: [], data: '' };
            send('250 OK queued');
          } else cur.data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        if (authStep === 'user') {
          authUser = Buffer.from(line, 'base64').toString('utf8');
          authStep = 'pass';
          send('334 UGFzc3dvcmQ6');
          continue;
        }
        if (authStep === 'pass') {
          authStep = '';
          const pass = Buffer.from(line, 'base64').toString('utf8');
          authed = Boolean(creds) && authUser === creds!.user && pass === creds!.pass;
          send(authed ? '235 Authentication successful' : '535 Authentication failed');
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') {
          if (creds) send('250-sink.test'), send('250-AUTH PLAIN LOGIN'), send('250 8BITMIME');
          else send('250-sink.test'), send('250 8BITMIME');
        } else if (cmd === 'AUTH') {
          const [, mech, arg] = line.split(' ');
          if (mech?.toUpperCase() === 'PLAIN' && arg) {
            authed = checkPlain(arg);
            send(authed ? '235 Authentication successful' : '535 Authentication failed');
          } else if (mech?.toUpperCase() === 'LOGIN') {
            authStep = 'user';
            send('334 VXNlcm5hbWU6');
          } else send('504 Unrecognized authentication type');
        } else if (cmd === 'MAIL') {
          if (failing) send('451 4.3.0 Temporary failure, try again later');
          else if (!authed) send('530 Authentication required');
          else (cur.from = line.replace(/^MAIL FROM:\s*/i, '')), send('250 OK');
        } else if (cmd === 'RCPT') cur.to.push(line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, '')), send('250 OK');
        else if (cmd === 'DATA') (inData = true), send('354 End data with <CR><LF>.<CR><LF>');
        else if (cmd === 'RSET') (cur = { from: '', to: [], data: '' }), send('250 OK');
        else if (cmd === 'NOOP') send('250 OK');
        else if (cmd === 'QUIT') send('221 Bye'), socket.end();
        else send('502 Command not implemented');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    messages,
    setFailing: (v: boolean) => {
      failing = v;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Waits until `check` returns a truthy value (fire-and-forget notifications are asynchronous). */
export async function eventually<T>(check: () => Promise<T> | T, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}
