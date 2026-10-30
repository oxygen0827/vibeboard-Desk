const test=require('node:test'),assert=require('node:assert/strict'),P=require('./physics.js');
test('five bodies remain finite and bounded after ten simulated minutes',()=>{
 const balls=P.create(480,216);let hits=0;
 for(let i=0;i<36000;i++)P.advance(balls,1/60,480,216,{x:Math.sin(i/240)*320,y:150+Math.cos(i/190)*300},i/60,()=>hits++);
 assert.ok(hits>50);for(const b of balls){for(const k of ['x','y','vx','vy'])assert.ok(Number.isFinite(b[k]));assert.ok(b.x>0&&b.x<480&&b.y>0&&b.y<216);}
});
test('coincident bodies separate without NaN and held body stays under pointer ownership',()=>{
 const balls=P.create(480,216);balls[0].x=balls[1].x;balls[0].y=balls[1].y;balls[2].held=true;const before={...balls[2]};P.advance(balls,1/60,480,216,{x:100,y:200},1,()=>{});
 assert.ok(Number.isFinite(balls[0].x));assert.deepEqual(balls[2],before);assert.ok(Math.hypot(balls[0].x-balls[1].x,balls[0].y-balls[1].y)>0);
});
test('long resume interval is bounded to avoid simulation explosions',()=>{const balls=P.create(480,216);P.advance(balls,60,480,216,{x:300,y:300},60,()=>{});for(const b of balls)assert.ok(Math.abs(b.vx)<600&&Math.abs(b.vy)<600);});
test('composition admission rejects unordered, oversized and invalid notes',()=>{
 const valid={duration:2,notes:[{t:.1,note:0,gain:.5},{t:1,note:4,gain:1}]};assert.ok(P.validPattern(valid));assert.equal(P.validPattern({...valid,duration:21}),false);assert.equal(P.validPattern({...valid,notes:valid.notes.toReversed()}),false);assert.equal(P.validPattern({...valid,notes:[{t:0,note:5,gain:.5}]}),false);assert.equal(P.validPattern({...valid,notes:Array(241).fill(valid.notes[0])}),false);
});
