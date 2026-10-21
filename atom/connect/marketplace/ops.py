#!/usr/bin/env python3
"""Local marketplace operations. Counts only; never dump source, user data or tokens."""
import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class OpsError(ValueError):
    pass


def database(path, writable=False):
    if not path:
        raise OpsError('--db is required')
    original=Path(path).expanduser()
    if original.is_symlink() or not original.is_file():
        raise OpsError('Database must be an existing regular file, not a symlink')
    resolved=original.resolve()
    uri='file:'+quote(str(resolved),safe='/')+'?mode='+('rw' if writable else 'ro')
    conn=sqlite3.connect(uri,uri=True,timeout=10)
    names={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'users','works','versions','drafts','notes','agenda'}.issubset(names):
        conn.close()
        raise OpsError('Not an ATOM marketplace database')
    return conn


def stats(path):
    conn=database(path)
    try:
        values={name:conn.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in ('users','sessions','works','versions','drafts','notes','agenda')}
        names={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        unlisted=conn.execute('SELECT COUNT(*) FROM visibility WHERE unlisted=1').fetchone()[0] if 'visibility' in names else 0
        values.update(unlisted_works=unlisted,listed_works=values['works']-unlisted,
                      database_bytes=conn.execute('PRAGMA page_count').fetchone()[0]*conn.execute('PRAGMA page_size').fetchone()[0])
        return values
    finally:
        conn.close()


def backup(path, output):
    source=database(path)
    target=Path(output).expanduser()
    created=False
    try:
        if target.is_symlink() or target.exists():
            raise OpsError('Backup destination already exists; use a new private filename')
        target.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
        fd=os.open(str(target),os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
        os.close(fd)
        created=True
        dest=sqlite3.connect(str(target))
        try:
            source.backup(dest,pages=256,sleep=0.1)
            if dest.execute('PRAGMA quick_check(1)').fetchone()[0]!='ok':
                raise OpsError('Backup integrity check failed')
            dest.commit()
        finally:
            dest.close()
        os.chmod(str(target),0o600)
        return {'ok':True,'backup_bytes':target.stat().st_size}
    except Exception:
        if created:
            target.unlink(missing_ok=True) if sys.version_info >= (3,8) else target.unlink()
        raise
    finally:
        source.close()


def visibility(path, work_id, unlisted, confirmation):
    if not isinstance(work_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',work_id) or confirmation!=work_id:
        raise OpsError('Pass --confirm with the exact --work-id to confirm this catalog change')
    conn=database(path,writable=True)
    try:
        with conn:
            if not conn.execute('SELECT 1 FROM works WHERE id=?',(work_id,)).fetchone():
                raise OpsError('Work not found')
            conn.execute('CREATE TABLE IF NOT EXISTS visibility(work TEXT PRIMARY KEY,unlisted INTEGER NOT NULL,updated REAL NOT NULL)')
            conn.execute('INSERT OR REPLACE INTO visibility VALUES(?,?,?)',(work_id,int(unlisted),time.time()))
        return {'ok':True,'work_id':work_id,'unlisted':unlisted}
    finally:
        conn.close()


def set_cover(path, work_id, image_path, confirmation):
    """Backfill a reviewed screenshot without altering source or existing covers."""
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',work_id or '') or confirmation!=work_id:
        raise OpsError('Confirm the exact work ID')
    import base64
    import covers
    from photos import PhotoError
    image_file=Path(image_path)
    if image_file.is_symlink() or not image_file.is_file() or image_file.stat().st_size>covers.MAX_UPLOAD:
        raise OpsError('Use a reviewed regular PNG or JPEG screenshot below 1 MiB')
    mime='image/png' if image_file.suffix.lower()=='.png' else 'image/jpeg'
    try: image,width,height=covers.normalize('data:'+mime+';base64,'+base64.b64encode(image_file.read_bytes()).decode())
    except PhotoError: raise OpsError('Invalid screenshot')
    conn=database(path,writable=True);conn.row_factory=sqlite3.Row
    class Store:
        db=conn
        clock=staticmethod(time.time)
        def row(self,sql,args=()):return conn.execute(sql,args).fetchone()
    try:
        with conn:
            row=conn.execute('SELECT user,data FROM works WHERE id=?',(work_id,)).fetchone()
            if not row:raise OpsError('Work not found')
            work=json.loads(row['data'])
            if work.get('cover_id'):return {'ok':True,'unchanged':True,'work_id':work_id}
            try: ident=covers.save(Store(),row['user'],image,width,height,True)
            except PhotoError:raise OpsError('Cover storage unavailable')
            work['cover_id']=ident
            conn.execute('UPDATE works SET data=? WHERE id=?',(json.dumps(work,ensure_ascii=False),work_id))
        return {'ok':True,'work_id':work_id,'cover_id':ident}
    finally:conn.close()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def health(path=None,url=None):
    if url:
        parsed=urlsplit(url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or not parsed.hostname:
            raise OpsError('Use the relay root URL without credentials or paths')
        if parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1','::1')):
            raise OpsError('HTTPS required except loopback development')
        try:
            with build_opener(NoRedirect()).open(Request(url.rstrip('/')+'/market/v1/health'),timeout=5) as response:
                data=response.read(1025)
                if len(data)>1024 or json.loads(data).get('ok') is not True:
                    raise OpsError('Health response invalid')
        except (OSError,ValueError):
            raise OpsError('Marketplace HTTP health check failed')
        return {'ok':True,'http':True}
    conn=database(path)
    try:
        if conn.execute('PRAGMA quick_check(1)').fetchone()[0]!='ok':
            raise OpsError('Database integrity check failed')
        return {'ok':True,'database':True}
    finally:
        conn.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',help='Existing marketplace SQLite path (not relay database)')
    sub=parser.add_subparsers(dest='command',required=True)
    h=sub.add_parser('health');h.add_argument('--url')
    sub.add_parser('stats')
    b=sub.add_parser('backup');b.add_argument('--output',required=True)
    for name in ('unlist','restore'):
        p=sub.add_parser(name);p.add_argument('--work-id',required=True);p.add_argument('--confirm',required=True)
    c=sub.add_parser('cover');c.add_argument('--work-id',required=True);c.add_argument('--image',required=True);c.add_argument('--confirm',required=True)
    args=parser.parse_args()
    try:
        if args.command=='health':result=health(args.db,args.url)
        elif args.command=='stats':result=stats(args.db)
        elif args.command=='cover':result=set_cover(args.db,args.work_id,args.image,args.confirm)
        elif args.command=='backup':result=backup(args.db,args.output)
        else:result=visibility(args.db,args.work_id,args.command=='unlist',args.confirm)
        print(json.dumps(result,ensure_ascii=False))
        return 0
    except (OpsError,sqlite3.Error,OSError):
        # No tracebacks/SQLite rows/paths; detailed credential-bearing state is never printed.
        print(json.dumps({'ok':False,'error':'Operation failed: verify database, private destination, confirmation and permissions'}),file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
