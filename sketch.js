const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const CORRECT_EFFECT_MS = 3000;
const ANSWER_COOLDOWN_MS = 900;
const STABLE_FRAMES_REQUIRED = 10;

const questions = [
  {
    text: "台灣最高的山是玉山。",
    answer: "YES",
    fact: "玉山主峰海拔約 3,952 公尺，是台灣最高峰。",
  },
  {
    text: "台灣的首都是高雄市。",
    answer: "NO",
    fact: "台灣中央政府所在地是台北市。",
  },
  {
    text: "日月潭位在南投縣。",
    answer: "YES",
    fact: "日月潭是南投縣魚池鄉的代表性景點。",
  },
  {
    text: "阿里山位在花蓮縣。",
    answer: "NO",
    fact: "阿里山主要位在嘉義縣。",
  },
  {
    text: "台灣本島四面環海。",
    answer: "YES",
    fact: "台灣本島位在西太平洋，周圍被海域環繞。",
  },
  {
    text: "台灣的國道 1 號又稱中山高速公路。",
    answer: "YES",
    fact: "國道 1 號常被稱為中山高速公路。",
  },
  {
    text: "台東縣在台灣本島的西部。",
    answer: "NO",
    fact: "台東縣位在台灣本島東南部。",
  },
  {
    text: "澎湖是台灣離島地區之一。",
    answer: "YES",
    fact: "澎湖縣由多個島嶼組成，是台灣重要離島縣市。",
  },
  {
    text: "台灣高鐵目前主要行駛於西部走廊。",
    answer: "YES",
    fact: "台灣高鐵主要連接台灣西部主要城市。",
  },
  {
    text: "淡水河主要流經屏東縣。",
    answer: "NO",
    fact: "淡水河流域主要位於北台灣。",
  },
];

// MediaPipe Face Mesh 路徑索引
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];
const MOUTH_OUTER = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17,
  84, 181, 91, 146,
];

let faceMesh;
let video;
let faces = [];
let cameraReady = false;
let modelReady = false;
let currentQuestion = 0;
let score = 0;
let phase = "answering";
let lastAnsweredAt = 0;
let correctStartedAt = 0;
let feedbackText = "";
let stableGesture = null;
let stableGestureFrames = 0;
let lastDetectedGesture = null;
let particles = [];
let detectionStarted = false;
let lastDomStatus = "";
let reduceMotion = false;

function setup() {
  const wrap = document.getElementById("canvas-wrap");
  const canvas = createCanvas(wrap.clientWidth, wrap.clientHeight);
  canvas.parent(wrap);
  canvas.elt.setAttribute(
    "aria-label",
    "webcam 影像、臉部骨架與台灣常識是非題遊戲畫面"
  );

  textFont("Noto Sans TC");
  pixelDensity(1);
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  video = createCapture(VIDEO, { flipped: true }, () => {
    cameraReady = true;
  });
  video.size(VIDEO_WIDTH, VIDEO_HEIGHT);
  video.hide();

  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true }, () => {
    modelReady = true;
    startFaceDetection();
  });
}

function draw() {
  drawCameraBackground();
  drawAtmosphere();
  updateGestureState();
  drawGamePanel();
  drawGestureGuide();
  drawFaceMesh();
  drawCorrectEffect();
}

function gotFaces(results) {
  faces = results || [];
}

function startFaceDetection() {
  if (detectionStarted || !modelReady || !faceMesh || !video) {
    return;
  }

  faceMesh.detectStart(video, gotFaces);
  detectionStarted = true;
}

function updateGestureState() {
  if (phase !== "answering") {
    return;
  }

  const gesture = detectMouthGesture(faces[0]);
  lastDetectedGesture = gesture;

  if (!gesture) {
    stableGesture = null;
    stableGestureFrames = 0;
    return;
  }

  if (stableGesture === gesture) {
    stableGestureFrames += 1;
  } else {
    stableGesture = gesture;
    stableGestureFrames = 1;
  }

  const canAnswer = millis() - lastAnsweredAt > ANSWER_COOLDOWN_MS;
  if (canAnswer && stableGestureFrames >= STABLE_FRAMES_REQUIRED) {
    submitAnswer(gesture);
  }
}

function submitAnswer(gesture) {
  lastAnsweredAt = millis();
  stableGestureFrames = 0;

  const question = questions[currentQuestion];
  if (gesture === question.answer) {
    score += 1;
    feedbackText = question.fact;
    phase = "correct";
    correctStartedAt = millis();
    createParticles();
  } else {
    feedbackText = `答錯了，請再試一次。提示：${question.fact}`;
  }
}

function advanceQuestion() {
  currentQuestion += 1;
  feedbackText = "";
  stableGesture = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;

  if (currentQuestion >= questions.length) {
    phase = "finished";
  } else {
    phase = "answering";
  }
}

function drawCameraBackground() {
  background(7, 17, 31);

  if (!video) {
    return;
  }

  const placement = getVideoPlacement();
  image(video, placement.x, placement.y, placement.w, placement.h);

  noStroke();
  fill(6, 12, 22, 112);
  rect(0, 0, width, height);
  fill(255, 248, 234, 18);
  for (let x = 0; x < width; x += 32) {
    rect(x, 0, 1, height);
  }
}

function drawAtmosphere() {
  noStroke();
  const pulse = reduceMotion ? 0 : sin(frameCount * 0.035) * 18;
  fill(246, 183, 60, 38);
  circle(width * 0.14, height * 0.2, 220 + pulse);
  fill(24, 181, 135, 34);
  circle(width * 0.86, height * 0.72, 280 - pulse);

  fill(0, 0, 0, 90);
  rect(0, 0, width, height);
}

function drawGamePanel() {
  const isMobile = width < 680;
  const panelX = isMobile ? 18 : 30;
  const panelY = isMobile ? 18 : 28;
  const panelW = isMobile ? width - 36 : min(530, width * 0.48);
  const panelH = isMobile ? 315 : 330;

  drawSoftPanel(panelX, panelY, panelW, panelH);

  fill(255, 214, 139);
  textSize(isMobile ? 13 : 14);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("台灣常識 / TRUE OR FALSE", panelX + 24, panelY + 22);

  fill(255);
  textSize(isMobile ? 21 : 26);
  textStyle(BOLD);

  if (phase === "finished") {
    updateDomStatus(
      `遊戲完成，總分 ${score} 分，共 ${questions.length} 題。按 R 可以重新開始。`
    );
    text(
      `完成！總分 ${score} / ${questions.length}`,
      panelX + 24,
      panelY + 58,
      panelW - 48
    );
    fill(234, 244, 239);
    textSize(isMobile ? 15 : 17);
    textStyle(NORMAL);
    text(
      "按 R 或點擊畫面可以重新開始。",
      panelX + 24,
      panelY + 108,
      panelW - 48
    );
    return;
  }

  const question = questions[currentQuestion];
  updateDomStatus(
    `第 ${currentQuestion + 1} 題：${question.text} 請作答。${getStatusText()}`
  );
  text(`第 ${currentQuestion + 1} / ${questions.length} 題`, panelX + 24, panelY + 58);

  fill(255, 248, 234);
  textSize(isMobile ? 22 : 28);
  textStyle(BOLD);
  text(question.text, panelX + 24, panelY + 102, panelW - 48);

  if (phase !== "correct") {
    fill(255, 214, 139);
    textSize(isMobile ? 18 : 20);
    text("請作答", panelX + 24, panelY + 190);
  }

  fill(220, 234, 238);
  textSize(isMobile ? 14 : 16);
  textStyle(NORMAL);
  const status = getStatusText();
  text(status, panelX + 24, panelY + 224, panelW - 48);

  if (feedbackText) {
    fill(phase === "correct" ? color(134, 255, 208) : color(255, 173, 154));
    textSize(isMobile ? 13 : 14);
    text(feedbackText, panelX + 24, panelY + 274, panelW - 48);
  }

  drawProgress(panelX + 24, panelY + panelH - 28, panelW - 48);
  drawScorePill(panelX + panelW - 126, panelY + 18);
}

function getStatusText() {
  if (!cameraReady) {
    return "等待 webcam 權限。請允許瀏覽器使用相機。";
  }

  if (!modelReady) {
    return "ml5 FaceMesh 模型載入中。";
  }

  if (!faces.length) {
    return "把臉放進畫面中，張大嘴代表 YES，緊閉嘴巴代表 NO。";
  }

  if (phase === "correct") {
    return "答對了，3 秒後進入下一題。";
  }

  if (lastDetectedGesture === "YES") {
    return "偵測到張嘴：YES。保持一下送出答案。";
  }

  if (lastDetectedGesture === "NO") {
    return "偵測到閉嘴：NO。保持一下送出答案。";
  }

  return "已偵測到臉部，請張大嘴（YES）或緊閉嘴巴（NO）。";
}

function updateDomStatus(status) {
  if (status === lastDomStatus) {
    return;
  }

  lastDomStatus = status;
  const statusNode = document.getElementById("game-status");
  if (statusNode) {
    statusNode.textContent = status;
  }
}

function drawScorePill(x, y) {
  noStroke();
  fill(255, 255, 255, 28);
  rect(x, y, 100, 34, 999);
  fill(255);
  textSize(14);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text(`分數 ${score}`, x + 50, y + 17);
}

function drawProgress(x, y, w) {
  noStroke();
  fill(255, 255, 255, 32);
  rect(x, y, w, 8, 99);

  const progress =
    phase === "finished" ? 1 : (currentQuestion + 1) / questions.length;
  fill(246, 183, 60);
  rect(x, y, w * progress, 8, 99);
}

function drawGestureGuide() {
  const isMobile = width < 680;
  const guideW = isMobile ? width - 36 : 400;
  const guideH = isMobile ? 118 : 128;
  const guideX = isMobile ? 18 : width - guideW - 30;
  const guideY = height - guideH - 24;

  drawSoftPanel(guideX, guideY, guideW, guideH);

  fill(255, 248, 234);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 15 : 16);
  text("嘴巴動作", guideX + 22, guideY + 18);

  drawChoiceChip(
    guideX + 22,
    guideY + 52,
    guideW * 0.42,
    "😮 YES（張嘴）",
    lastDetectedGesture === "YES"
  );
  drawChoiceChip(
    guideX + 42 + guideW * 0.42,
    guideY + 52,
    guideW * 0.42,
    "😐 NO（閉嘴）",
    lastDetectedGesture === "NO"
  );

  fill(218, 230, 226);
  textSize(isMobile ? 12 : 13);
  textStyle(NORMAL);
  text("答錯不扣分，系統會要求你再試一次。", guideX + 22, guideY + 94, guideW - 44);
}

function drawChoiceChip(x, y, w, label, active) {
  noStroke();
  fill(active ? color(24, 181, 135, 215) : color(255, 255, 255, 30));
  rect(x, y, w, 32, 999);
  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(14);
  text(label, x + w / 2, y + 16);
}

function drawSoftPanel(x, y, w, h) {
  noStroke();
  fill(5, 12, 22, 176);
  rect(x + 6, y + 10, w, h, 28);
  fill(12, 24, 38, 214);
  rect(x, y, w, h, 28);
  stroke(255, 248, 234, 42);
  noFill();
  rect(x + 0.5, y + 0.5, w - 1, h - 1, 28);
}

function drawFaceMesh() {
  if (!faces.length) {
    return;
  }

  const face = faces[0];
  const points = face.keypoints;
  if (!points || points.length < 200) {
    return;
  }

  const mapped = points.map((p) => mapVideoPointToCanvas({ x: p.x, y: p.y }));

  // 臉部輪廓
  stroke(255, 248, 234, 90);
  strokeWeight(width < 680 ? 1.5 : 2);
  strokeCap(ROUND);
  noFill();
  beginShape();
  for (const i of FACE_OVAL) {
    vertex(mapped[i].x, mapped[i].y);
  }
  endShape(CLOSE);

  // 嘴巴輪廓（依偵測狀態上色）
  const gesture = detectMouthGesture(face);
  const mouthCol =
    gesture === "YES"
      ? color(24, 181, 135, 230)
      : gesture === "NO"
        ? color(246, 183, 60, 230)
        : color(255, 248, 234, 180);
  stroke(mouthCol);
  strokeWeight(width < 680 ? 3 : 4);
  noFill();
  beginShape();
  for (const i of MOUTH_OUTER) {
    vertex(mapped[i].x, mapped[i].y);
  }
  endShape(CLOSE);

  // 上下嘴唇關鍵點（13 = 上唇內側中央，14 = 下唇內側中央）
  noStroke();
  fill(246, 183, 60);
  circle(mapped[13].x, mapped[13].y, 10);
  fill(24, 181, 135);
  circle(mapped[14].x, mapped[14].y, 10);
}

function detectMouthGesture(face) {
  if (!face) {
    return null;
  }

  const points = face.keypoints;
  if (!points || points.length < 200) {
    return null;
  }

  const upperLip = points[13]; // 上唇內側中央
  const lowerLip = points[14]; // 下唇內側中央
  const topFace = points[10];  // 額頭頂部
  const bottomFace = points[152]; // 下巴底部

  if (!upperLip || !lowerLip || !topFace || !bottomFace) {
    return null;
  }

  const faceHeight = Math.abs(bottomFace.y - topFace.y);
  if (faceHeight < 40) {
    return null; // 臉太小（距離太遠）
  }

  const mouthGap = Math.abs(lowerLip.y - upperLip.y);
  const ratio = mouthGap / faceHeight;

  if (ratio > 0.07) {
    return "YES"; // 嘴巴明顯張開
  }

  if (ratio < 0.025) {
    return "NO"; // 嘴巴明顯閉合
  }

  return null;
}

function drawCorrectEffect() {
  if (phase !== "correct") {
    return;
  }

  const elapsed = millis() - correctStartedAt;
  const t = reduceMotion ? 1 : constrain(elapsed / CORRECT_EFFECT_MS, 0, 1);

  noStroke();
  fill(24, 181, 135, 70 * (1 - t));
  rect(0, 0, width, height);

  push();
  translate(width / 2, height / 2);
  noFill();
  strokeWeight(5);
  stroke(255, 248, 234, 180 * (1 - t));
  circle(0, 0, 120 + 360 * t);
  stroke(246, 183, 60, 180 * (1 - t));
  circle(0, 0, 60 + 260 * t);
  pop();

  if (!reduceMotion) {
    updateParticles();
  }

  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(width < 680 ? 38 : 64);
  text("答對了！", width / 2, height / 2);

  if (elapsed >= CORRECT_EFFECT_MS) {
    advanceQuestion();
  }
}

function createParticles() {
  particles = [];
  for (let i = 0; i < 70; i += 1) {
    particles.push({
      x: width / 2,
      y: height / 2,
      vx: random(-7, 7),
      vy: random(-8, 5),
      life: random(42, 72),
      size: random(4, 9),
      hue: random([0, 1, 2]),
    });
  }
}

function updateParticles() {
  noStroke();
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;
    p.life -= 1;

    const alpha = constrain(p.life * 4, 0, 220);
    if (p.hue === 0) {
      fill(246, 183, 60, alpha);
    } else if (p.hue === 1) {
      fill(24, 181, 135, alpha);
    } else {
      fill(255, 248, 234, alpha);
    }
    circle(p.x, p.y, p.size);
  }
}

function mapVideoPointToCanvas(point) {
  const p = Array.isArray(point) ? { x: point[0], y: point[1] } : point;
  const placement = getVideoPlacement();
  return {
    x: placement.x + (p.x / VIDEO_WIDTH) * placement.w,
    y: placement.y + (p.y / VIDEO_HEIGHT) * placement.h,
  };
}

function getVideoPlacement() {
  const videoRatio = VIDEO_WIDTH / VIDEO_HEIGHT;
  const canvasRatio = width / height;

  if (canvasRatio > videoRatio) {
    const w = width;
    const h = width / videoRatio;
    return { x: 0, y: (height - h) / 2, w, h };
  }

  const h = height;
  const w = height * videoRatio;
  return { x: (width - w) / 2, y: 0, w, h };
}

function keyPressed() {
  if (key === "r" || key === "R") {
    restartGame();
  }
}

function mousePressed() {
  if (phase === "finished") {
    restartGame();
  }
}

function restartGame() {
  currentQuestion = 0;
  score = 0;
  phase = "answering";
  feedbackText = "";
  particles = [];
  stableGesture = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;
}

function windowResized() {
  const wrap = document.getElementById("canvas-wrap");
  resizeCanvas(wrap.clientWidth, wrap.clientHeight);
}
