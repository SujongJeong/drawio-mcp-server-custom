import { WebSocket } from 'ws';

console.log('🧪 WebSocket 연결 테스트...');
const ws = new WebSocket('ws://localhost:3333');

ws.on('open', () => {
  console.log('✅ WebSocket 연결 성공!');
  console.log('📤 테스트 메시지 전송...');
  ws.send(JSON.stringify({ test: 'hello from test client' }));
  
  setTimeout(() => {
    console.log('👋 연결 종료');
    ws.close();
  }, 2000);
});

ws.on('message', (data) => {
  console.log('📥 서버로부터 메시지:', data.toString());
});

ws.on('error', (error) => {
  console.error('❌ WebSocket 에러:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 연결 종료됨');
  process.exit(0);
});
