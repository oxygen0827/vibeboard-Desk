"""Outgoing mail over SMTP, configured from the environment. Standard library only; never logs message bodies."""
import os
import smtplib
import ssl
import sys
import threading
from email.message import EmailMessage
from email.utils import formataddr, make_msgid


def settings(env=None):
    env = os.environ if env is None else env
    values = {k: env.get('SMTP_' + k.upper(), '').strip() for k in ('host', 'port', 'user', 'password', 'from')}
    if not (values['host'] and values['user'] and values['password'] and values['from']):
        return None
    # Plain SMTP is only for a local test relay; anything else must use TLS.
    plain = env.get('SMTP_TLS', '').strip().lower() == 'off' and values['host'] in ('127.0.0.1', 'localhost')
    return dict(host=values['host'], port=int(values['port'] or 465), user=values['user'], password=values['password'],
                sender=values['from'], alert_to=env.get('ALERT_TO', '').strip(), plain=plain)


class Mailer:
    def __init__(self, config=None, transport=None):
        self.config = settings() if config is None else config or None
        self.transport = transport or self._smtp

    @property
    def configured(self):
        return bool(self.config)

    def message(self, to, subject, body):
        msg = EmailMessage()
        msg['From'] = formataddr(('ATOM', self.config['sender']))
        msg['To'] = to
        msg['Subject'] = subject
        msg['Message-ID'] = make_msgid(domain=self.config['sender'].rsplit('@', 1)[-1])
        msg.set_content(body)
        return msg

    def send(self, to, subject, body, wait=False):
        """Queue a message; returns False when SMTP is not configured. Delivery runs off the request thread."""
        if not self.configured:
            return False
        msg = self.message(to, subject, body)
        if wait:
            self.transport(msg)
            return True
        threading.Thread(target=self._deliver, args=(msg,), daemon=True).start()
        return True

    def _deliver(self, msg):
        try:
            self.transport(msg)
        except Exception as exc:  # delivery is best effort; report the failure class only
            print('mail delivery failed: ' + type(exc).__name__, file=sys.stderr)

    def _smtp(self, msg):
        c = self.config
        context = ssl.create_default_context()
        if c.get('plain'):
            with smtplib.SMTP(c['host'], c['port'], timeout=20) as server:
                server.send_message(msg)
            return
        if c['port'] == 465:
            server = smtplib.SMTP_SSL(c['host'], c['port'], timeout=20, context=context)
        else:
            server = smtplib.SMTP(c['host'], c['port'], timeout=20)
            server.starttls(context=context)
        with server:
            server.login(c['user'], c['password'])
            server.send_message(msg)
