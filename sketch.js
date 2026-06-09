const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const CALIBRATION_SAMPLE_MS = 1000;
const CORRECT_EFFECT_MS = 3000;
const ANSWER_COOLDOWN_MS = 900;
const ANSWER_GRACE_MS = 1200;
const YES_STABLE_FRAMES_REQUIRED = 10;
const NO_STABLE_FRAMES_REQUIRED = 36;

const STATE = {
  INTRO: "intro",
  CAMERA_PERMISSION: "cameraPermission",
  MODEL_LOADING: "modelLoading",
  CALIBRATION_CLOSED: "calibrationClosed",
  CALIBRATION_OPEN: "calibrationOpen",
  ANSWERING: "answering",
  CORRECT_EFFECT: "correctEffect",
  FINISHED: "finished",
};

const C = {
  ink: [42, 40, 37],
  inkSoft: [76, 70, 63],
  paper: [247, 244, 239],
  paperDeep: [230, 225, 214],
  stone: [154, 144, 134],
  forest: [77, 115, 88],
  moss: [118, 151, 111],
  clay: [181, 119, 90],
  sand: [200, 180, 154],
  gold: [210, 164, 82],
  night: [22, 19, 16],
};

const questions = [
  { text: "台灣最高的山是玉山。", answer: "YES", fact: "玉山主峰海拔約 3,952 公尺，是台灣最高峰。" },
  { text: "台灣的首都是高雄市。", answer: "NO", fact: "台灣中央政府所在地是台北市。" },
  { text: "日月潭位在南投縣。", answer: "YES", fact: "日月潭是南投縣魚池鄉的代表性景點。" },
  { text: "阿里山位在花蓮縣。", answer: "NO", fact: "阿里山主要位在嘉義縣。" },
  { text: "台灣本島四面環海。", answer: "YES", fact: "台灣本島位在西太平洋，周圍被海域環繞。" },
  { text: "台灣的國道 1 號又稱中山高速公路。", answer: "YES", fact: "國道 1 號常被稱為中山高速公路。" },
  { text: "台東縣在台灣本島的西部。", answer: "NO", fact: "台東縣位在台灣本島東南部。" },
  { text: "澎湖是台灣離島地區之一。", answer: "YES", fact: "澎湖縣由多個島嶼組成，是台灣重要離島縣市。" },
  { text: "台灣高鐵目前主要行駛於西部走廊。", answer: "YES", fact: "台灣高鐵主要連接台灣西部主要城市。" },
  { text: "淡水河主要流經屏東縣。", answer: "NO", fact: "淡水河流域主要位於北台灣。" },
];

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
let cameraReady = false;
let modelReady = false;
let detectionStarted = false;
let reduceMotion = false;

let phase = STATE.INTRO;
let phaseStartedAt = 0;
let currentQuestion = 0;
let firstTryScore = 0;
let currentMistakes = 0;
let answerRecords = [];
let feedbackText = "";
let correctStartedAt = 0;
let lastAnsweredAt = 0;
let stableGesture = null;
let stableGestureFrames = 0;
let lastDetectedGesture = null;
let currentReading = { ratio: null, gesture: null };
let particles = [];
let lastDomStatus = "";

const calibration = {
  closedSamples: [],
  openSamples: [],
  sampleStartedAt: 0,
  closedRatio: 0.025,
  openRatio: 0.08,
  noThreshold: 0.035,
  yesThreshold: 0.065,
  ready: false,
};

function setup() {
  const wrap = document.getElementById("canvas-wrap");
  const canvas = createCanvas(wrap.clientWidth, wrap.clientHeight);
  canvas.parent(wrap);
  canvas.elt.setAttribute("aria-label", "台灣常識嘴巴快問快答 webcam 遊戲畫面");

  textFont("Noto Sans TC");
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  phaseStartedAt = millis();

  const startLink = document.querySelector(".start-link");
  if (startLink) {
    startLink.addEventListener("click", (event) => {
      event.preventDefault();
      wrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      beginExperience();
    });
  }
}

function draw() {
  drawStage();
  currentReading = getMouthReading();

  if (isCalibrationPhase()) {
    updateCalibration();
  } else if (phase === STATE.ANSWERING) {
    updateAnswering();
  }

  if (faces.length && phase !== STATE.INTRO && phase !== STATE.FINISHED) {
    drawFaceMesh();
  }

  if (phase === STATE.INTRO) drawIntroPanel();
  if (phase === STATE.CAMERA_PERMISSION || phase === STATE.MODEL_LOADING) drawLoadingPanel();
  if (isCalibrationPhase()) drawCalibrationPanel();
  if (phase === STATE.ANSWERING || phase === STATE.CORRECT_EFFECT) {
    drawQuestionHud();
    drawBottomHud();
  }
  if (phase === STATE.CORRECT_EFFECT) drawCorrectEffect();
  if (phase === STATE.FINISHED) drawResultReport();

  updateDomStatus(getAriaStatus());
}

function beginExperience() {
  if (phase !== STATE.INTRO && phase !== STATE.FINISHED) return;

  resetGameData();
  setPhase(STATE.CAMERA_PERMISSION);
  initCamera();
  initModel();
  maybeStartDetectionAndCalibration();
}

function initCamera() {
  if (video) {
    cameraReady = true;
    return;
  }

  video = createCapture(
    { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT } }, audio: false },
    () => {
      cameraReady = true;
      maybeStartDetectionAndCalibration();
    }
  );
  video.size(VIDEO_WIDTH, VIDEO_HEIGHT);
  video.hide();
}

function initModel() {
  if (faceMesh) return;

  faceMesh = ml5.faceMesh({ maxFaces: 1, flipped: true }, () => {
    modelReady = true;
    maybeStartDetectionAndCalibration();
  });
}

function maybeStartDetectionAndCalibration() {
  if (!cameraReady) {
    setPhase(STATE.CAMERA_PERMISSION);
    return;
  }

  if (!modelReady) {
    setPhase(STATE.MODEL_LOADING);
    return;
  }

  startFaceDetection();
  startCalibration();
}

function startFaceDetection() {
  if (detectionStarted || !faceMesh || !video) return;
  faceMesh.detectStart(video, gotFaces);
  detectionStarted = true;
}

function gotFaces(results) {
  faces = results || [];
}

function setPhase(nextPhase) {
  if (phase === nextPhase) return;
  phase = nextPhase;
  phaseStartedAt = millis();
  lastDomStatus = "";

  if (isCalibrationPhase()) {
    calibration.sampleStartedAt = 0;
  }

  if (phase === STATE.ANSWERING) {
    stableGesture = null;
    stableGestureFrames = 0;
    lastDetectedGesture = null;
  }
}

function startCalibration() {
  calibration.closedSamples = [];
  calibration.openSamples = [];
  calibration.sampleStartedAt = 0;
  calibration.ready = false;
  setPhase(STATE.CALIBRATION_CLOSED);
}

function updateCalibration() {
  const ratio = currentReading.ratio;
  if (ratio === null) {
    calibration.sampleStartedAt = 0;
    return;
  }

  if (!calibration.sampleStartedAt) {
    calibration.sampleStartedAt = millis();
  }

  if (phase === STATE.CALIBRATION_CLOSED) {
    calibration.closedSamples.push(ratio);
  } else {
    calibration.openSamples.push(ratio);
  }

  if (millis() - calibration.sampleStartedAt < CALIBRATION_SAMPLE_MS) return;

  if (phase === STATE.CALIBRATION_CLOSED) {
    calibration.closedRatio = median(calibration.closedSamples);
    calibration.sampleStartedAt = 0;
    setPhase(STATE.CALIBRATION_OPEN);
    return;
  }

  calibration.openRatio = median(calibration.openSamples);
  finishCalibration();
}

function finishCalibration() {
  let closed = calibration.closedRatio;
  let open = calibration.openRatio;

  if (!Number.isFinite(closed)) closed = 0.025;
  if (!Number.isFinite(open)) open = 0.08;
  if (open < closed) [closed, open] = [open, closed];

  let gap = open - closed;
  if (gap < 0.025) {
    gap = 0.04;
    open = closed + gap;
  }

  calibration.closedRatio = closed;
  calibration.openRatio = open;
  calibration.noThreshold = closed + gap * 0.32;
  calibration.yesThreshold = closed + gap * 0.68;
  calibration.ready = true;

  setPhase(STATE.ANSWERING);
}

function updateAnswering() {
  if (millis() - phaseStartedAt < ANSWER_GRACE_MS) {
    stableGesture = null;
    stableGestureFrames = 0;
    lastDetectedGesture = null;
    return;
  }

  const gesture = currentReading.gesture;
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
  const requiredFrames = getRequiredFrames(gesture);
  if (canAnswer && stableGestureFrames >= requiredFrames) {
    submitAnswer(gesture);
  }
}

function submitAnswer(gesture) {
  lastAnsweredAt = millis();
  stableGestureFrames = 0;

  const question = questions[currentQuestion];
  if (gesture === question.answer) {
    const firstTry = currentMistakes === 0;
    if (firstTry) firstTryScore += 1;

    answerRecords[currentQuestion] = {
      number: currentQuestion + 1,
      text: question.text,
      answer: question.answer,
      fact: question.fact,
      firstTry,
      mistakes: currentMistakes,
    };

    feedbackText = question.fact;
    correctStartedAt = millis();
    createParticles();
    setPhase(STATE.CORRECT_EFFECT);
  } else {
    currentMistakes += 1;
    feedbackText = `答錯了，再試一次。提示：${question.fact}`;
    phaseStartedAt = millis();
  }
}

function advanceQuestion() {
  currentQuestion += 1;
  currentMistakes = 0;
  feedbackText = "";
  stableGesture = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;

  if (currentQuestion >= questions.length) {
    setPhase(STATE.FINISHED);
  } else {
    setPhase(STATE.ANSWERING);
  }
}

function resetGameData() {
  currentQuestion = 0;
  firstTryScore = 0;
  currentMistakes = 0;
  answerRecords = [];
  feedbackText = "";
  stableGesture = null;
  stableGestureFrames = 0;
  lastDetectedGesture = null;
  particles = [];
}

function getMouthReading() {
  const ratio = getMouthRatio(faces[0]);
  return { ratio, gesture: classifyMouthRatio(ratio) };
}

function getMouthRatio(face) {
  if (!face || !face.keypoints || face.keypoints.length < 153) return null;

  const points = face.keypoints;
  const upper = points[13];
  const lower = points[14];
  const top = points[10];
  const bottom = points[152];
  if (!upper || !lower || !top || !bottom) return null;

  const faceHeight = Math.abs(bottom.y - top.y);
  if (faceHeight < 40) return null;

  return Math.abs(lower.y - upper.y) / faceHeight;
}

function classifyMouthRatio(ratio) {
  if (ratio === null) return null;

  if (ratio >= calibration.yesThreshold) return "YES";
  if (ratio <= calibration.noThreshold) return "NO";
  return null;
}

function getRequiredFrames(gesture) {
  return gesture === "NO" ? NO_STABLE_FRAMES_REQUIRED : YES_STABLE_FRAMES_REQUIRED;
}

function isCalibrationPhase() {
  return phase === STATE.CALIBRATION_CLOSED || phase === STATE.CALIBRATION_OPEN;
}

function drawStage() {
  background(...C.night);

  if (video) {
    const placement = getVideoPlacement();
    push();
    translate(placement.x + placement.w, placement.y);
    scale(-1, 1);
    image(video, 0, 0, placement.w, placement.h);
    pop();
  } else {
    drawIdleBackdrop();
  }

  noStroke();
  fill(14, 13, 12, phase === STATE.INTRO || phase === STATE.FINISHED ? 122 : 72);
  rect(0, 0, width, height);
  drawGridTexture();
}

function drawIdleBackdrop() {
  noStroke();
  fill(...C.ink);
  rect(0, 0, width, height);
  fill(...C.forest, 75);
  drawTaiwanSilhouette(width * 0.65, height * 0.54, min(width, height) * 0.62, -0.16);
  fill(...C.clay, 40);
  circle(width * 0.22, height * 0.22, min(width, height) * 0.38);
}

function drawGridTexture() {
  stroke(...C.paper, 14);
  strokeWeight(1);
  for (let x = 0; x < width; x += 42) line(x, 0, x, height);
  for (let y = 0; y < height; y += 42) line(0, y, width, y);
}

function drawIntroPanel() {
  const isMobile = width < 680;
  const panelW = isMobile ? width - 36 : min(620, width * 0.58);
  const panelH = isMobile ? 370 : 355;
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;

  drawPanel(panelX, panelY, panelW, panelH, 24, 236);
  drawKicker("ML5 FACEMESH / CALIBRATED QUIZ", panelX + 26, panelY + 26);

  fill(...C.ink);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 26 : 36);
  text("台灣常識嘴巴快問快答", panelX + 26, panelY + 66, panelW - 52);

  fill(...C.inkSoft);
  textStyle(NORMAL);
  textSize(isMobile ? 14 : 16);
  text(
    "開始後會先做閉嘴與張嘴校正，再用個人化門檻判斷 YES / NO。畫面會顯示開合值、穩定度與錯題報告。",
    panelX + 26,
    panelY + 128,
    panelW - 52
  );

  const steps = ["1. 允許 webcam", "2. 閉嘴校正 1 秒", "3. 張嘴校正 1 秒", "4. 開始答題"];
  for (let i = 0; i < steps.length; i += 1) {
    drawStepPill(panelX + 26, panelY + 205 + i * 34, panelW - 52, steps[i]);
  }

  drawPrimaryButton(panelX + 26, panelY + panelH - 58, panelW - 52, "點擊畫面或按上方「開始遊戲」");
}

function drawLoadingPanel() {
  const textLine = phase === STATE.CAMERA_PERMISSION
    ? "等待 webcam 權限，請允許瀏覽器使用相機。"
    : "FaceMesh 模型載入中，準備建立臉部與嘴巴骨架。";

  const isMobile = width < 680;
  const panelW = isMobile ? width - 36 : min(560, width * 0.52);
  const panelH = 220;
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;

  drawPanel(panelX, panelY, panelW, panelH, 22, 238);
  drawKicker("SYSTEM CHECK", panelX + 24, panelY + 24);
  fill(...C.ink);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 24 : 30);
  text(phase === STATE.CAMERA_PERMISSION ? "相機權限" : "模型載入", panelX + 24, panelY + 64);
  fill(...C.inkSoft);
  textStyle(NORMAL);
  textSize(15);
  text(textLine, panelX + 24, panelY + 112, panelW - 48);
  drawIndeterminateBar(panelX + 24, panelY + 170, panelW - 48);
}

function drawCalibrationPanel() {
  const isMobile = width < 680;
  const panelW = isMobile ? width - 32 : min(620, width * 0.58);
  const panelH = isMobile ? 350 : 330;
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  const isClosed = phase === STATE.CALIBRATION_CLOSED;
  const title = isClosed ? "校正 1 / 2：自然閉嘴" : "校正 2 / 2：張大嘴";
  const instruction = isClosed
    ? "請自然閉嘴並看著鏡頭，系統會記錄你的閉嘴基準。"
    : "請張大嘴一秒，系統會記錄你的 YES 基準。";
  const progress = getCalibrationProgress();

  drawPanel(panelX, panelY, panelW, panelH, 24, 238);
  drawKicker("PERSONAL CALIBRATION", panelX + 26, panelY + 24);

  fill(...C.ink);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 25 : 34);
  text(title, panelX + 26, panelY + 66, panelW - 52);

  fill(...C.inkSoft);
  textStyle(NORMAL);
  textSize(isMobile ? 14 : 16);
  text(currentReading.ratio === null ? "請把臉放進畫面，讓 FaceMesh 偵測到嘴巴。" : instruction, panelX + 26, panelY + 120, panelW - 52);

  drawCalibrationProgress(panelX + 26, panelY + 185, panelW - 52, progress);
  drawMouthMeter(panelX + 26, panelY + 235, panelW - 52, "目前嘴巴開合值");

  fill(...C.stone);
  textStyle(NORMAL);
  textSize(12);
  text("校正後門檻會依你的臉部比例自動產生，不再使用固定數值。", panelX + 26, panelY + panelH - 34, panelW - 52);
}

function drawQuestionHud() {
  const isMobile = width < 680;
  const margin = isMobile ? 12 : 20;
  const hudH = isMobile ? 164 : 174;

  drawPanel(margin, margin, width - margin * 2, hudH, 20, 224);
  drawProgressBar(margin, margin, width - margin * 2, 5);

  fill(...C.stone);
  textStyle(BOLD);
  textSize(isMobile ? 11 : 12);
  textAlign(LEFT, TOP);
  text(`Q ${currentQuestion + 1} / ${questions.length}`, margin + 22, margin + 18);
  textAlign(RIGHT, TOP);
  text(`首答分數 ${firstTryScore}`, width - margin - 22, margin + 18);

  const question = questions[currentQuestion];
  fill(...C.ink);
  textAlign(CENTER, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 23 : 32);
  text(question.text, margin + 24, margin + (isMobile ? 48 : 50), width - margin * 2 - 48);

  const promptY = margin + (isMobile ? 112 : 122);
  if (phase === STATE.CORRECT_EFFECT) {
    fill(...C.forest);
    textSize(isMobile ? 14 : 16);
    text("答對了，3 秒後進入下一題", width / 2, promptY);
  } else {
    fill(...C.clay);
    textStyle(BOLD);
    textSize(isMobile ? 15 : 16);
    text("請作答", width / 2, promptY);
    fill(...C.inkSoft);
    textStyle(NORMAL);
    textSize(isMobile ? 12 : 13);
    text(getStatusText(), margin + 28, promptY + 26, width - margin * 2 - 56);
  }

  if (feedbackText && phase === STATE.ANSWERING) {
    fill(...C.clay);
    textStyle(NORMAL);
    textSize(isMobile ? 11 : 12);
    text(feedbackText, margin + 30, margin + hudH - 28, width - margin * 2 - 60);
  }
}

function drawBottomHud() {
  const isMobile = width < 680;
  const margin = isMobile ? 12 : 20;
  const hudH = isMobile ? 180 : 150;
  const hudY = height - margin - hudH;

  drawPanel(margin, hudY, width - margin * 2, hudH, 20, 224);

  const chipW = isMobile ? (width - margin * 2 - 54) / 2 : 170;
  const chipH = 38;
  const chipGap = isMobile ? 10 : 14;
  const chipsW = chipW * 2 + chipGap;
  const chipX = (width - chipsW) / 2;
  const chipY = hudY + 18;

  drawChip(chipX, chipY, chipW, chipH, "YES 張大嘴", lastDetectedGesture === "YES", C.forest);
  drawChip(chipX + chipW + chipGap, chipY, chipW, chipH, "NO 閉嘴", lastDetectedGesture === "NO", C.clay);

  const meterX = margin + 24;
  const meterW = width - margin * 2 - 48;
  drawMouthMeter(meterX, hudY + (isMobile ? 72 : 76), meterW, "嘴巴開合值");
  drawStabilityMeter(meterX, hudY + (isMobile ? 126 : 116), meterW);
}

function drawFaceMesh() {
  const face = faces[0];
  if (!face || !face.keypoints || face.keypoints.length < 153) return;

  const mapped = face.keypoints.map((point) => mapVideoPointToCanvas(point));
  const mouthColor = currentReading.gesture === "YES"
    ? [...C.forest, 235]
    : currentReading.gesture === "NO"
      ? [...C.clay, 235]
      : [...C.paper, 145];

  stroke(...C.paper, 88);
  strokeWeight(width < 680 ? 1.2 : 1.6);
  noFill();
  beginShape();
  for (const index of FACE_OVAL) vertex(mapped[index].x, mapped[index].y);
  endShape(CLOSE);

  stroke(...mouthColor);
  strokeWeight(width < 680 ? 3 : 4);
  beginShape();
  for (const index of MOUTH_OUTER) vertex(mapped[index].x, mapped[index].y);
  endShape(CLOSE);

  noStroke();
  fill(...C.forest);
  circle(mapped[13].x, mapped[13].y, width < 680 ? 8 : 10);
  fill(...C.clay);
  circle(mapped[14].x, mapped[14].y, width < 680 ? 8 : 10);

  if (currentReading.ratio !== null) {
    fill(...C.paper, 220);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(12);
    text(`開合 ${currentReading.ratio.toFixed(3)}`, mapped[14].x, mapped[14].y + 30);
  }
}

function drawCorrectEffect() {
  const elapsed = millis() - correctStartedAt;
  const t = reduceMotion ? 1 : constrain(elapsed / CORRECT_EFFECT_MS, 0, 1);
  const isMobile = width < 680;

  noStroke();
  fill(...C.forest, 72 * (1 - t));
  rect(0, 0, width, height);

  if (!reduceMotion) updateParticles();

  push();
  translate(width / 2, height / 2);
  fill(...C.forest, 125 * (1 - t));
  drawTaiwanSilhouette(0, 0, min(width, height) * (0.48 + t * 0.18), -0.18);
  noFill();
  stroke(...C.gold, 180 * (1 - t));
  strokeWeight(3);
  circle(0, 0, min(width, height) * (0.28 + t * 0.42));
  pop();

  const cardW = isMobile ? width - 42 : min(560, width * 0.52);
  const cardH = isMobile ? 148 : 160;
  const cardX = (width - cardW) / 2;
  const cardY = height / 2 - cardH / 2;

  drawPanel(cardX, cardY, cardW, cardH, 20, 238);
  drawKicker("TAIWAN KNOWLEDGE CARD", cardX + 24, cardY + 20);
  fill(...C.forest);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(isMobile ? 34 : 46);
  text("答對了", width / 2, cardY + cardH * 0.43);
  fill(...C.inkSoft);
  textStyle(NORMAL);
  textSize(isMobile ? 13 : 15);
  text(feedbackText, cardX + 26, cardY + cardH * 0.66, cardW - 52);

  if (elapsed >= CORRECT_EFFECT_MS) advanceQuestion();
}

function drawResultReport() {
  const isMobile = width < 680;
  const margin = isMobile ? 14 : 30;
  const panelW = width - margin * 2;
  const panelH = height - margin * 2;
  const panelX = margin;
  const panelY = margin;
  const missed = answerRecords.filter((record) => !record.firstTry);
  const totalMistakes = answerRecords.reduce((sum, record) => sum + record.mistakes, 0);

  drawPanel(panelX, panelY, panelW, panelH, 24, 240);
  drawKicker("FINAL REPORT", panelX + 26, panelY + 24);

  fill(...C.ink);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(isMobile ? 28 : 42);
  text(`首答分數 ${firstTryScore} / ${questions.length}`, panelX + 26, panelY + 62);

  fill(...C.inkSoft);
  textStyle(NORMAL);
  textSize(isMobile ? 13 : 15);
  text(`總錯誤嘗試 ${totalMistakes} 次。${missed.length ? "下方是需要複習的題目。" : "所有題目都一次答對。"}`, panelX + 26, panelY + (isMobile ? 108 : 118), panelW - 52);

  const listY = panelY + (isMobile ? 158 : 174);
  const rowH = isMobile ? 60 : 54;
  const rows = missed.length ? missed : answerRecords.slice(0, 5);
  const maxRows = max(1, floor((panelY + panelH - listY - 74) / rowH));
  const label = missed.length ? "錯題複習" : "答題紀錄";
  fill(...C.clay);
  textStyle(BOLD);
  textSize(13);
  text(label, panelX + 26, listY - 28);

  for (let i = 0; i < rows.length && i < maxRows; i += 1) {
    const record = rows[i];
    const y = listY + i * rowH;
    fill(...C.ink, i % 2 === 0 ? 12 : 5);
    noStroke();
    rect(panelX + 18, y - 6, panelW - 36, rowH - 6, 6);

    fill(...C.ink);
    textStyle(BOLD);
    textSize(isMobile ? 12 : 13);
    text(`Q${record.number} ${record.answer}`, panelX + 28, y);
    fill(...C.inkSoft);
    textStyle(NORMAL);
    textSize(isMobile ? 11 : 12);
    text(record.text, panelX + 86, y, panelW - 160);
    fill(...C.stone);
    textSize(isMobile ? 10 : 11);
    text(record.fact, panelX + 86, y + 21, panelW - 136);
    fill(record.firstTry ? color(...C.forest) : color(...C.clay));
    textAlign(RIGHT, TOP);
    text(record.firstTry ? "首答正確" : `錯 ${record.mistakes} 次`, panelX + panelW - 28, y);
    textAlign(LEFT, TOP);
  }

  if (rows.length > maxRows) {
    fill(...C.stone);
    textStyle(NORMAL);
    textSize(11);
    text(`另有 ${rows.length - maxRows} 題未顯示，可重新遊玩加強練習。`, panelX + 28, listY + maxRows * rowH + 4);
  }

  fill(...C.stone);
  textStyle(NORMAL);
  textSize(12);
  text("按 R 或點擊畫面重新校正並再玩一次。", panelX + 26, panelY + panelH - 38, panelW - 52);
}

function drawMouthMeter(x, y, w, label) {
  const h = 8;
  const minRatio = max(0, calibration.closedRatio - 0.02);
  const maxRatio = calibration.openRatio + 0.025;
  const ratio = currentReading.ratio;
  const value = ratio === null ? 0 : constrain((ratio - minRatio) / (maxRatio - minRatio), 0, 1);
  const noMark = constrain((calibration.noThreshold - minRatio) / (maxRatio - minRatio), 0, 1);
  const yesMark = constrain((calibration.yesThreshold - minRatio) / (maxRatio - minRatio), 0, 1);

  fill(...C.inkSoft);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(11);
  text(`${label} ${ratio === null ? "--" : ratio.toFixed(3)}`, x, y);

  noStroke();
  fill(...C.ink, 22);
  rect(x, y + 20, w, h, 99);
  fill(...C.sand, 160);
  rect(x, y + 20, w * value, h, 99);
  fill(...C.clay);
  rect(x + w * noMark - 1, y + 16, 2, h + 8);
  fill(...C.forest);
  rect(x + w * yesMark - 1, y + 16, 2, h + 8);
}

function drawStabilityMeter(x, y, w) {
  const required = stableGesture ? getRequiredFrames(stableGesture) : YES_STABLE_FRAMES_REQUIRED;
  const progress = stableGesture ? constrain(stableGestureFrames / required, 0, 1) : 0;
  const label = stableGesture ? `${stableGesture} 穩定度 ${stableGestureFrames} / ${required}` : "等待穩定動作";

  fill(...C.inkSoft);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(11);
  text(label, x, y);

  noStroke();
  fill(...C.ink, 22);
  rect(x, y + 20, w, 8, 99);
  fill(stableGesture === "YES" ? color(...C.forest) : color(...C.clay));
  rect(x, y + 20, w * progress, 8, 99);
}

function drawCalibrationProgress(x, y, w, progress) {
  noStroke();
  fill(...C.ink, 20);
  rect(x, y, w, 12, 99);
  fill(...C.forest);
  rect(x, y, w * progress, 12, 99);

  fill(...C.inkSoft);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  textSize(12);
  text(`取樣進度 ${round(progress * 100)}%`, x, y + 20);
}

function getCalibrationProgress() {
  if (!calibration.sampleStartedAt || currentReading.ratio === null) return 0;
  return constrain((millis() - calibration.sampleStartedAt) / CALIBRATION_SAMPLE_MS, 0, 1);
}

function drawChip(x, y, w, h, label, active, col) {
  noStroke();
  fill(active ? color(...col, 230) : color(...C.ink, 18));
  rect(x, y, w, h, 7);
  stroke(...C.ink, active ? 0 : 45);
  noFill();
  rect(x + 0.5, y + 0.5, w - 1, h - 1, 7);
  noStroke();
  fill(active ? color(...C.paper) : color(...C.ink));
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(13);
  text(label, x + w / 2, y + h / 2);
}

function drawStepPill(x, y, w, label) {
  noStroke();
  fill(...C.ink, 12);
  rect(x, y, w, 26, 6);
  fill(...C.inkSoft);
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  textSize(12);
  text(label, x + 12, y + 13);
}

function drawPrimaryButton(x, y, w, label) {
  noStroke();
  fill(...C.forest);
  rect(x, y, w, 40, 6);
  fill(...C.paper);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(14);
  text(label, x + w / 2, y + 20);
}

function drawKicker(label, x, y) {
  fill(...C.clay);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(11);
  text(label, x, y);
}

function drawPanel(x, y, w, h, r, alpha = 230) {
  noStroke();
  fill(0, 0, 0, 40);
  rect(x + 7, y + 9, w, h, r);
  fill(...C.paper, alpha);
  rect(x, y, w, h, r);
  stroke(...C.ink, 25);
  strokeWeight(1);
  noFill();
  rect(x + 0.5, y + 0.5, w - 1, h - 1, r);
}

function drawProgressBar(x, y, w, h) {
  const progress = phase === STATE.FINISHED ? 1 : (currentQuestion + 1) / questions.length;
  noStroke();
  fill(...C.ink, 16);
  rect(x, y, w, h, 99);
  fill(...C.forest);
  rect(x, y, w * progress, h, 99);
}

function drawIndeterminateBar(x, y, w) {
  noStroke();
  fill(...C.ink, 20);
  rect(x, y, w, 8, 99);
  const moving = reduceMotion ? 0.5 : (sin(frameCount * 0.08) + 1) / 2;
  fill(...C.forest);
  rect(x + (w - w * 0.24) * moving, y, w * 0.24, 8, 99);
}

function createParticles() {
  particles = [];
  for (let i = 0; i < 72; i += 1) {
    particles.push({
      x: width / 2,
      y: height / 2,
      vx: random(-6, 6),
      vy: random(-7, 4),
      life: random(40, 72),
      size: random(3, 8),
      col: random([C.forest, C.clay, C.sand, C.gold]),
    });
  }
}

function updateParticles() {
  noStroke();
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.16;
    p.life -= 1;
    fill(...p.col, constrain(p.life * 4, 0, 220));
    circle(p.x, p.y, p.size);
  }
}

function drawTaiwanSilhouette(cx, cy, size, rotation = 0) {
  const points = [
    [0.05, -0.52], [0.22, -0.43], [0.28, -0.28], [0.22, -0.09],
    [0.29, 0.12], [0.21, 0.32], [0.07, 0.52], [-0.1, 0.43],
    [-0.18, 0.22], [-0.27, 0.04], [-0.2, -0.17], [-0.08, -0.35],
  ];

  push();
  translate(cx, cy);
  rotate(rotation);
  beginShape();
  for (const [px, py] of points) vertex(px * size, py * size);
  endShape(CLOSE);
  pop();
}

function mapVideoPointToCanvas(point) {
  const placement = getVideoPlacement();
  return {
    x: placement.x + (point.x / VIDEO_WIDTH) * placement.w,
    y: placement.y + (point.y / VIDEO_HEIGHT) * placement.h,
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

function getStatusText() {
  if (!faces.length) return "把臉放進畫面，讓系統看到嘴巴。";
  if (lastDetectedGesture === "YES") return "偵測到 YES，保持張嘴直到穩定度滿格。";
  if (lastDetectedGesture === "NO") return "偵測到 NO，請保持閉嘴久一點避免誤觸。";
  return "張大嘴代表 YES；自然閉嘴代表 NO。";
}

function getAriaStatus() {
  if (phase === STATE.INTRO) return "遊戲待開始。按開始後會啟用相機、載入 FaceMesh，並進行嘴巴校正。";
  if (phase === STATE.CAMERA_PERMISSION) return "等待 webcam 權限。";
  if (phase === STATE.MODEL_LOADING) return "FaceMesh 模型載入中。";
  if (phase === STATE.CALIBRATION_CLOSED) return "校正第一步，請自然閉嘴一秒。";
  if (phase === STATE.CALIBRATION_OPEN) return "校正第二步，請張大嘴一秒。";
  if (phase === STATE.ANSWERING) {
    return `第 ${currentQuestion + 1} 題：${questions[currentQuestion].text} 請作答。${feedbackText || getStatusText()}`;
  }
  if (phase === STATE.CORRECT_EFFECT) return `第 ${currentQuestion + 1} 題答對了。${feedbackText}`;
  return `遊戲完成，首答分數 ${firstTryScore} 分，共 ${questions.length} 題。`;
}

function updateDomStatus(status) {
  if (status === lastDomStatus) return;
  lastDomStatus = status;
  const node = document.getElementById("game-status");
  if (node) node.textContent = status;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function keyPressed() {
  if (key === "r" || key === "R") {
    beginExperience();
  }
}

function mousePressed() {
  if (phase === STATE.INTRO || phase === STATE.FINISHED) beginExperience();
}

function touchStarted() {
  if (phase === STATE.INTRO || phase === STATE.FINISHED) {
    beginExperience();
    return false;
  }
  return true;
}

function windowResized() {
  const wrap = document.getElementById("canvas-wrap");
  resizeCanvas(wrap.clientWidth, wrap.clientHeight);
}
