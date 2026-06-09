const VIDEO_WIDTH  = 1280;
const VIDEO_HEIGHT = 720;
const CORRECT_EFFECT_MS     = 3000;
const ANSWER_COOLDOWN_MS    = 900;
const STABLE_FRAMES_REQUIRED = 10;
const NO_STABLE_FRAMES_REQUIRED = 36;
const ANSWER_GRACE_MS = 1200;

// 無印色盤
const C_INK    = [42, 40, 37];
const C_PAPER  = [247, 244, 239];
const C_STONE  = [154, 144, 134];
const C_FOREST = [77, 115, 88];
const C_CLAY   = [181, 119, 90];
const C_SAND   = [200, 180, 154];

const questions = [
  { text: "台灣最高的山是玉山。",           answer: "YES", fact: "玉山主峰海拔約 3,952 公尺，是台灣最高峰。" },
  { text: "台灣的首都是高雄市。",           answer: "NO",  fact: "台灣中央政府所在地是台北市。" },
  { text: "日月潭位在南投縣。",             answer: "YES", fact: "日月潭是南投縣魚池鄉的代表性景點。" },
  { text: "阿里山位在花蓮縣。",             answer: "NO",  fact: "阿里山主要位在嘉義縣。" },
  { text: "台灣本島四面環海。",             answer: "YES", fact: "台灣本島位在西太平洋，周圍被海域環繞。" },
  { text: "台灣的國道 1 號又稱中山高速公路。", answer: "YES", fact: "國道 1 號常被稱為中山高速公路。" },
  { text: "台東縣在台灣本島的西部。",       answer: "NO",  fact: "台東縣位在台灣本島東南部。" },
  { text: "澎湖是台灣離島地區之一。",       answer: "YES", fact: "澎湖縣由多個島嶼組成，是台灣重要離島縣市。" },
  { text: "台灣高鐵目前主要行駛於西部走廊。", answer: "YES", fact: "台灣高鐵主要連接台灣西部主要城市。" },
  { text: "淡水河主要流經屏東縣。",         answer: "NO",  fact: "淡水河流域主要位於北台灣。" },
];

// MediaPipe Face Mesh 路徑索引
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const MOUTH_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

let faceMesh;
let video;
let faces = [];
let cameraReady  = false;
let modelReady   = false;
let currentQuestion = 0;
let score = 0;
let phase = "answering";
let lastAnsweredAt   = 0;
let correctStartedAt = 0;
let questionStartedAt = 0;
let feedbackText = "";
let stableGesture       = null;
let stableGestureFrames = 0;
let lastDetectedGesture = null;
let particles    = [];
let detectionStarted = false;
let lastDomStatus    = "";
let reduceMotion     = false;

// ── 初始化 ────────────────────────────────────────────

function setup() {
  const wrap   = document.getElementById("canvas-wrap");
  const canvas = createCanvas(wrap.clientWidth, wrap.clientHeight);
  canvas.parent(wrap);
  canvas.elt.setAttribute("aria-label", "台灣常識是非題遊戲畫面");

  textFont("Noto Sans TC");
  // 配合 Retina 螢幕提升畫質，上限 2x 避免效能問題
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));

  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 請求 720p，video 不加 flipped（改在 draw 手動鏡像）
  video = createCapture(
    { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT } } },
    () => { cameraReady = true; }
  );
  video.size(VIDEO_WIDTH, VIDEO_HEIGHT);
  video.hide();

  // ml5 flipped:true 讓骨架座標對齊翻轉後的影像
  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true }, () => {
    modelReady = true;
    startFaceDetection();
  });
}

// ── 主迴圈 ────────────────────────────────────────────

function draw() {
  drawVideo();
  updateGestureState();
  drawTopBar();
  drawBottomBar();
  drawFaceMesh();
  drawCorrectEffect();
}

// ── 相機 ──────────────────────────────────────────────

function drawVideo() {
  background(...C_INK);
  if (!video) return;

  const pl = getVideoPlacement();

  // 水平翻轉：讓畫面如鏡子
  push();
  translate(pl.x + pl.w, pl.y);
  scale(-1, 1);
  image(video, 0, 0, pl.w, pl.h);
  pop();

  // 輕薄暗幕，讓 HUD 文字更易讀
  noStroke();
  fill(0, 0, 0, 55);
  rect(0, 0, width, height);
}

// ── 偵測 ──────────────────────────────────────────────

function gotFaces(results) { faces = results || []; }

function startFaceDetection() {
  if (detectionStarted || !modelReady || !faceMesh || !video) return;
  faceMesh.detectStart(video, gotFaces);
  detectionStarted = true;
}

function updateGestureState() {
  if (phase !== "answering") return;

  if (millis() - questionStartedAt < ANSWER_GRACE_MS) {
    lastDetectedGesture = null;
    stableGesture = null;
    stableGestureFrames = 0;
    return;
  }

  const gesture = detectMouthGesture(faces[0]);
  lastDetectedGesture = gesture;

  if (!gesture) { stableGesture = null; stableGestureFrames = 0; return; }

  if (stableGesture === gesture) { stableGestureFrames += 1; }
  else { stableGesture = gesture; stableGestureFrames = 1; }

  const canAnswer = millis() - lastAnsweredAt > ANSWER_COOLDOWN_MS;
  const requiredFrames = gesture === "NO" ? NO_STABLE_FRAMES_REQUIRED : STABLE_FRAMES_REQUIRED;
  if (canAnswer && stableGestureFrames >= requiredFrames) submitAnswer(gesture);
}

function detectMouthGesture(face) {
  if (!face) return null;
  const pts = face.keypoints;
  if (!pts || pts.length < 200) return null;

  const upper  = pts[13];   // 上唇內側中央
  const lower  = pts[14];   // 下唇內側中央
  const top    = pts[10];   // 額頭頂
  const bottom = pts[152];  // 下巴底

  if (!upper || !lower || !top || !bottom) return null;

  const faceH = Math.abs(bottom.y - top.y);
  if (faceH < 40) return null;

  const gap   = Math.abs(lower.y - upper.y);
  const ratio = gap / faceH;

  if (ratio > 0.07)  return "YES";
  if (ratio < 0.025) return "NO";
  return null;
}

function submitAnswer(gesture) {
  lastAnsweredAt      = millis();
  stableGestureFrames = 0;

  const q = questions[currentQuestion];
  if (gesture === q.answer) {
    score      += 1;
    feedbackText = q.fact;
    phase        = "correct";
    correctStartedAt = millis();
    createParticles();
  } else {
    feedbackText = `答錯了，再試一次。\n提示：${q.fact}`;
    questionStartedAt = millis();
  }
}

function advanceQuestion() {
  currentQuestion += 1;
  feedbackText        = "";
  stableGesture       = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;
  questionStartedAt = millis();
  phase = currentQuestion >= questions.length ? "finished" : "answering";
}

// ── 上方題目列 ────────────────────────────────────────

function drawTopBar() {
  const isMobile = width < 680;
  const barH     = isMobile ? 156 : 178;

  // 白底半透明面板
  noStroke();
  fill(...C_PAPER, 236);
  rect(0, 0, width, barH);

  // 底部細線
  stroke(...C_INK, 28);
  strokeWeight(1);
  line(0, barH, width, barH);

  // 進度條（最頂端 3px，森林綠）
  noStroke();
  fill(...C_INK, 16);
  rect(0, 0, width, 3);
  const progress = phase === "finished" ? 1 : (currentQuestion + 1) / questions.length;
  fill(...C_FOREST);
  rect(0, 0, width * progress, 3);

  // ── 遊戲結束 ──
  if (phase === "finished") {
    updateDomStatus(`遊戲完成，總分 ${score} 分。按 R 或點擊重新開始。`);
    textAlign(CENTER, CENTER);
    fill(...C_INK);
    textStyle(NORMAL);
    textSize(isMobile ? 28 : 40);
    text(`總分 ${score} / ${questions.length}`, width / 2, barH * 0.4);
    fill(...C_STONE);
    textSize(isMobile ? 13 : 15);
    text("按 R 或點擊畫面重新開始", width / 2, barH * 0.72);
    return;
  }

  const q = questions[currentQuestion];
  updateDomStatus(`第 ${currentQuestion + 1} 題：${q.text}　請作答。${feedbackText ? feedbackText.replace("\n", " ") : getStatusText()}`);

  // 題號（左）、分數（右）
  textStyle(NORMAL);
  textSize(isMobile ? 11 : 12);
  fill(...C_STONE);
  textAlign(LEFT, TOP);
  text(`Q ${currentQuestion + 1} / ${questions.length}`, 22, 12);
  textAlign(RIGHT, TOP);
  text(`分數　${score}`, width - 22, 12);

  // 題目文字（最顯眼，居中）
  // text(str, x, y, w) 中 x 是文字框左邊緣，CENTER 決定框內對齊方式
  textAlign(CENTER, TOP);
  fill(...C_INK);
  textStyle(BOLD);
  textSize(isMobile ? 22 : 30);
  text(q.text, 24, isMobile ? 38 : 42, width - 48);

  // 狀態提示
  const hintY = isMobile ? 118 : 135;
  textStyle(NORMAL);
  textSize(isMobile ? 12 : 13);
  if (phase === "correct") {
    fill(...C_FOREST);
    text("答對了，3 秒後進入下一題", width / 2, hintY);
  } else {
    fill(...C_CLAY);
    textStyle(BOLD);
    text("請作答", width / 2, hintY - (isMobile ? 20 : 24));
    textStyle(NORMAL);
    fill(...C_STONE);
    text(getStatusText(), 30, hintY, width - 60);
  }
}

// ── 下方手勢列 ────────────────────────────────────────

function drawBottomBar() {
  const isMobile = width < 680;
  const hasErrorFeedback = feedbackText && phase !== "correct";
  const barH = isMobile ? (hasErrorFeedback ? 132 : 72) : 80;
  const barY = height - barH;

  // 白底半透明面板
  noStroke();
  fill(...C_PAPER, 236);
  rect(0, barY, width, barH);

  // 頂部細線
  stroke(...C_INK, 28);
  strokeWeight(1);
  line(0, barY, width, barY);

  // 晶片
  const chipW   = isMobile ? 126 : 152;
  const chipH   = 38;
  const chipGap = isMobile ? 10 : 14;
  const chipY   = isMobile && hasErrorFeedback ? barY + 14 : barY + (barH - chipH) / 2;
  const startX  = (width - (chipW * 2 + chipGap)) / 2;

  drawChip(startX,             chipY, chipW, chipH, "😮  YES（張嘴）", lastDetectedGesture === "YES", C_FOREST);
  drawChip(startX + chipW + chipGap, chipY, chipW, chipH, "😐  NO（閉嘴）",  lastDetectedGesture === "NO",  C_CLAY);

  // 答錯回饋
  if (hasErrorFeedback && isMobile) {
    noStroke();
    fill(...C_CLAY);
    textAlign(CENTER, TOP);
    textStyle(NORMAL);
    textSize(11);
    text(feedbackText.replace("\n", " "), 18, barY + 62, width - 36);
  } else if (hasErrorFeedback) {
    noStroke();
    fill(...C_CLAY);
    textAlign(RIGHT, CENTER);
    textStyle(NORMAL);
    textSize(12);
    text(feedbackText, width - 20, barY + barH / 2, 260);
  }
}

function drawChip(x, y, w, h, label, active, col) {
  noStroke();
  if (active) {
    fill(...col, 220);
    rect(x, y, w, h, 2);
    fill(...C_PAPER);
  } else {
    fill(...C_INK, 14);
    rect(x, y, w, h, 2);
    stroke(...C_INK, 40);
    strokeWeight(1);
    noFill();
    rect(x + 0.5, y + 0.5, w - 1, h - 1, 2);
    noStroke();
    fill(...C_INK);
  }
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(13);
  text(label, x + w / 2, y + h / 2);
}

// ── 臉部骨架 ──────────────────────────────────────────

function drawFaceMesh() {
  if (!faces.length) return;
  const face = faces[0];
  const pts  = face.keypoints;
  if (!pts || pts.length < 200) return;

  const mapped = pts.map(p => mapVideoPointToCanvas({ x: p.x, y: p.y }));

  // 臉部輪廓（深石色，低不透明）
  stroke(...C_INK, 70);
  strokeWeight(1.5);
  strokeCap(ROUND);
  noFill();
  beginShape();
  for (const i of FACE_OVAL) vertex(mapped[i].x, mapped[i].y);
  endShape(CLOSE);

  // 嘴巴輪廓（依偵測狀態上色）
  const gesture = detectMouthGesture(face);
  const mCol = gesture === "YES" ? [...C_FOREST, 230] :
               gesture === "NO"  ? [...C_CLAY,   230] :
                                   [...C_INK,    110];
  stroke(...mCol);
  strokeWeight(3);
  noFill();
  beginShape();
  for (const i of MOUTH_OUTER) vertex(mapped[i].x, mapped[i].y);
  endShape(CLOSE);

  // 上唇（13）/ 下唇（14）關鍵點
  noStroke();
  fill(...C_FOREST);
  circle(mapped[13].x, mapped[13].y, 9);
  fill(...C_CLAY);
  circle(mapped[14].x, mapped[14].y, 9);
}

// ── 答對特效 ──────────────────────────────────────────

function drawCorrectEffect() {
  if (phase !== "correct") return;

  const elapsed = millis() - correctStartedAt;
  const t = reduceMotion ? 1 : constrain(elapsed / CORRECT_EFFECT_MS, 0, 1);

  // 淡綠覆蓋
  noStroke();
  fill(...C_FOREST, 50 * (1 - t));
  rect(0, 0, width, height);

  // 擴散圓環（淡色）
  push();
  translate(width / 2, height / 2);
  noFill();
  strokeWeight(3);
  stroke(...C_PAPER, 160 * (1 - t));
  circle(0, 0, 100 + 360 * t);
  stroke(...C_SAND, 140 * (1 - t));
  circle(0, 0, 50 + 240 * t);
  pop();

  if (!reduceMotion) updateParticles();

  // 標題背景卡片
  const isMobile = width < 680;
  const cardW = isMobile ? width - 48 : 520;
  const cardH = isMobile ? 130 : 150;
  const cardX = (width - cardW) / 2;
  const cardY = height / 2 - cardH / 2;

  noStroke();
  fill(...C_PAPER, 230);
  rect(cardX, cardY, cardW, cardH, 4);
  stroke(...C_INK, 20);
  strokeWeight(1);
  noFill();
  rect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 4);

  // 答對文字
  noStroke();
  fill(...C_FOREST);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(isMobile ? 34 : 46);
  text("答對了", width / 2, cardY + cardH * 0.36);

  // 知識補充
  if (feedbackText) {
    fill(...C_STONE);
    textStyle(NORMAL);
    textSize(isMobile ? 13 : 15);
    text(feedbackText, width / 2, cardY + cardH * 0.72, cardW - 40);
  }

  if (elapsed >= CORRECT_EFFECT_MS) advanceQuestion();
}

// ── 粒子 ──────────────────────────────────────────────

function createParticles() {
  particles = [];
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: width / 2, y: height / 2,
      vx: random(-5, 5), vy: random(-7, 4),
      life: random(38, 65), size: random(3, 7),
      col: random([C_FOREST, C_CLAY, C_SAND]),
    });
  }
}

function updateParticles() {
  noStroke();
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.life -= 1;
    fill(...p.col, constrain(p.life * 4, 0, 200));
    circle(p.x, p.y, p.size);
  }
}

// ── 座標映射 ──────────────────────────────────────────

function mapVideoPointToCanvas(point) {
  const p  = Array.isArray(point) ? { x: point[0], y: point[1] } : point;
  const pl = getVideoPlacement();
  return {
    x: pl.x + (p.x / VIDEO_WIDTH)  * pl.w,
    y: pl.y + (p.y / VIDEO_HEIGHT) * pl.h,
  };
}

function getVideoPlacement() {
  const vr = VIDEO_WIDTH / VIDEO_HEIGHT;
  const cr = width / height;
  if (cr > vr) {
    const w = width, h = width / vr;
    return { x: 0, y: (height - h) / 2, w, h };
  }
  const h = height, w = height * vr;
  return { x: (width - w) / 2, y: 0, w, h };
}

// ── 狀態文字 ──────────────────────────────────────────

function getStatusText() {
  if (!cameraReady)             return "等待 webcam 權限，請允許瀏覽器使用相機。";
  if (!modelReady)              return "FaceMesh 模型載入中…";
  if (!faces.length)            return "把臉放進畫面。張大嘴 → YES　緊閉嘴巴 → NO";
  if (phase === "correct")      return "答對了，3 秒後進入下一題。";
  if (lastDetectedGesture === "YES") return "偵測到張嘴（YES）── 保持一下送出答案";
  if (lastDetectedGesture === "NO")  return "偵測到閉嘴（NO）── 請保持久一點，避免誤觸";
  return "已偵測到臉部，請張大嘴（YES）或緊閉嘴巴（NO）。";
}

function updateDomStatus(status) {
  if (status === lastDomStatus) return;
  lastDomStatus = status;
  const node = document.getElementById("game-status");
  if (node) node.textContent = status;
}

// ── 輸入 ──────────────────────────────────────────────

function keyPressed()  { if (key === "r" || key === "R") restartGame(); }
function mousePressed() { if (phase === "finished") restartGame(); }

function restartGame() {
  currentQuestion     = 0;
  score               = 0;
  phase               = "answering";
  questionStartedAt   = millis();
  feedbackText        = "";
  particles           = [];
  stableGesture       = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;
}

function windowResized() {
  const wrap = document.getElementById("canvas-wrap");
  resizeCanvas(wrap.clientWidth, wrap.clientHeight);
}
