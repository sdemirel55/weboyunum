// SFD Sketch Vote Only - otomatik yazı güvenliği kaldırıldı - 2026-06-12
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");
const DB_BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_LATEST_BACKUP_FILE = path.join(DB_BACKUP_DIR, "users.latest-backup.json");
const TOKEN_COOKIE = "sfd_token";
const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_CODE_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function getIstanbulParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = {};
  for (const part of parts) map[part.type] = part.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getIstanbulDayKey(date = new Date()) {
  const p = getIstanbulParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function getIstanbulWeekKey(date = new Date()) {
  const p = getIstanbulParts(date);
  const utcDate = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function emptyDb() {
  return {
    users: [],
    tokens: {},
    settings: {
      weeklyResetKey: getIstanbulWeekKey(new Date())
    }
  };
}

function normalizeDb(parsed) {
  return {
    users: Array.isArray(parsed && parsed.users) ? parsed.users : [],
    tokens: parsed && parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {},
    settings: parsed && parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}
  };
}

function isValidUserDb(db) {
  if (!db || !Array.isArray(db.users) || db.users.length === 0) return false;
  return db.users.some((user) => (
    user &&
    typeof user === "object" &&
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    typeof user.passwordHash === "string"
  ));
}

function readDbFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    console.warn(`[SFD DB] Okunamayan aday: ${filePath} (${error.message})`);
    return null;
  }
}

function writeDbAtomic(filePath, db) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(normalizeDb(db), null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function listJsonFiles(directory) {
  try {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
    return fs.readdirSync(directory)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .map((name) => path.join(directory, name));
  } catch (error) {
    return [];
  }
}

function collectRecoveryCandidatePaths() {
  const candidates = new Set();
  const currentDbPath = path.resolve(DB_FILE);
  const add = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (resolved !== currentDbPath) candidates.add(resolved);
  };

  // Bu sürümün ve muhtemel eski sürümlerin bıraktığı standart yedekler.
  add(DB_LATEST_BACKUP_FILE);
  listJsonFiles(DB_BACKUP_DIR).forEach(add);
  [
    "users.json.bak",
    "users.json.backup",
    "users.json.old",
    "users.backup.json",
    "users-old.json",
    "users_backup.json"
  ].forEach((name) => add(path.join(DATA_DIR, name)));

  const skippedDirectories = new Set([
    "node_modules", ".git", "public", "sounds", "images", "logs", "tmp", "temp"
  ]);
  const recoveryNamePattern = /^users(?:[._-].*)?(?:\.json|\.bak|\.old|\.backup)$/i;
  let visitedDirectories = 0;
  const maxVisitedDirectories = 600;

  function scanTree(directory, depth) {
    if (depth < 0 || visitedDirectories >= maxVisitedDirectories) return;
    let entries;
    try {
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return;
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      return;
    }

    visitedDirectories++;
    for (const entry of entries) {
      if (visitedDirectories >= maxVisitedDirectories) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        if (recoveryNamePattern.test(entry.name) || entry.name.toLowerCase() === "users.json") add(fullPath);
        continue;
      }
      if (!entry.isDirectory() || skippedDirectories.has(entry.name.toLowerCase())) continue;
      scanTree(fullPath, depth - 1);
    }
  }

  // ZIP farklı klasöre açıldıysa veya hosting eski klasörü sakladıysa bulmaya çalış.
  scanTree(__dirname, 3);
  scanTree(path.dirname(__dirname), 3);

  return [...candidates];
}

function findBestRecoveryDb() {
  const found = [];
  for (const filePath of collectRecoveryCandidatePaths()) {
    const db = readDbFile(filePath);
    if (!isValidUserDb(db)) continue;
    let modifiedAt = 0;
    try { modifiedAt = fs.statSync(filePath).mtimeMs || 0; } catch (error) {}
    found.push({ filePath, db, userCount: db.users.length, modifiedAt });
  }

  found.sort((a, b) => {
    if (b.userCount !== a.userCount) return b.userCount - a.userCount;
    return b.modifiedAt - a.modifiedAt;
  });
  return found[0] || null;
}

function backupExistingDb() {
  try {
    const current = readDbFile(DB_FILE);
    if (!isValidUserDb(current)) return;
    if (!fs.existsSync(DB_BACKUP_DIR)) fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
    writeDbAtomic(DB_LATEST_BACKUP_FILE, current);
    const dailyBackup = path.join(DB_BACKUP_DIR, `users-${getIstanbulDayKey(new Date())}.json`);
    if (!fs.existsSync(dailyBackup)) writeDbAtomic(dailyBackup, current);
  } catch (error) {
    console.error("[SFD DB] Kullanıcı yedeği alınamadı:", error.message);
  }
}

function restoreBestRecoveryDb(reason) {
  const recovered = findBestRecoveryDb();
  if (!recovered) return null;

  try {
    if (fs.existsSync(DB_FILE)) {
      const damagedCopy = path.join(DATA_DIR, `users.empty-or-damaged-${Date.now()}.json`);
      fs.copyFileSync(DB_FILE, damagedCopy);
    }
  } catch (error) {}

  writeDbAtomic(DB_FILE, recovered.db);
  console.warn(
    `[SFD DB] ${reason} ${recovered.userCount} kullanıcı geri getirildi. Kaynak: ${recovered.filePath}`
  );
  return recovered.db;
}

function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  backupExistingDb();
  writeDbAtomic(DB_FILE, db);
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const recovered = restoreBestRecoveryDb("users.json bulunamadı;");
      if (recovered) return recovered;
      const db = emptyDb();
      writeDbAtomic(DB_FILE, db);
      return db;
    }

    const parsed = readDbFile(DB_FILE);
    if (!parsed) {
      const recovered = restoreBestRecoveryDb("users.json bozuk;");
      if (recovered) return recovered;
      return emptyDb();
    }

    if (!isValidUserDb(parsed)) {
      const recovered = restoreBestRecoveryDb("users.json boş;");
      if (recovered) return recovered;
    }

    return parsed;
  } catch (error) {
    console.error("users.json okunamadı:", error.message);
    const recovered = restoreBestRecoveryDb("Veritabanı okuma hatası sonrası;");
    return recovered || emptyDb();
  }
}

let authDb = loadDb();

const DEFAULT_SCORE_SETTINGS = {
  guesserFirstPoints: 10,
  guesserMinPoints: 5,
  drawerFirstCorrectPoints: 10,
  drawerAdditionalCorrectPoints: 1,
  drawerAdditionalCorrectLimit: 5,
  hintPenalty: 2,
  globalAwardRankGroups: 3,

  // Eski arayüz/API alanlarıyla uyumluluk için tutuluyor.
  correctMin: 5,
  correctTimeMultiplier: 0,
  drawerBonus: 10
};

function getScoreSettings() {
  if (!authDb.settings) authDb.settings = {};

  // Puan sistemi sabittir. Eski kayıtlardaki farklı değerlerin yeni
  // sistemi bozmasına izin verilmez.
  authDb.settings.scoreSettings = { ...DEFAULT_SCORE_SETTINGS };
  return authDb.settings.scoreSettings;
}

function updateScoreSettings() {
  if (!authDb.settings) authDb.settings = {};
  authDb.settings.scoreSettings = { ...DEFAULT_SCORE_SETTINGS };
  saveDb(authDb);
  return authDb.settings.scoreSettings;
}


function validateBirthDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const currentYear = getIstanbulParts(new Date()).year;

  if (!d || !m || !y) {
    return {
      ok: false,
      message: "Doğum gün, ay ve yıl zorunlu."
    };
  }

  if (y < 1940 || y > currentYear - 5) {
    return {
      ok: false,
      message: "Doğum yılı geçerli değil."
    };
  }

  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return {
      ok: false,
      message: "Doğum tarihi geçerli değil."
    };
  }

  return {
    ok: true,
    birthDay: String(d).padStart(2, "0"),
    birthMonth: String(m).padStart(2, "0"),
    birthYear: y
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  let clean = String(phone || "").replace(/\D/g, "");

  // +90 / 90 ile girilirse 0'lı formata çevir: 905449656103 -> 05449656103
  if (clean.length === 12 && clean.startsWith("90")) {
    clean = "0" + clean.slice(2);
  }

  return clean.slice(0, 11);
}

function validateTurkishPhone(phone) {
  const clean = normalizePhone(phone);

  // Türkiye mobil formatı: 05XXXXXXXXX, toplam 11 hane
  if (!/^05\d{9}$/.test(clean)) {
    return {
      ok: false,
      phone: clean,
      message: "Telefon 11 haneli olmalı ve 05 ile başlamalı. Örnek: 05449656103"
    };
  }

  const withoutZero = clean.slice(1); // 5xxxxxxxxx

  // Aynı rakam tekrarları: 05555555555, 05000000000 vb.
  if (/^(\d)\1+$/.test(withoutZero)) {
    return {
      ok: false,
      phone: clean,
      message: "Geçerli bir telefon numarası yazmalısın."
    };
  }

  // Çok basit sahte seriler
  const fakeNumbers = new Set([
    "05000000000",
    "05050505050",
    "05111111111",
    "05222222222",
    "05333333333",
    "05444444444",
    "05555555555",
    "05666666666",
    "05777777777",
    "05888888888",
    "05999999999",
    "05432154321",
    "05123456789",
    "05987654321"
  ]);

  if (fakeNumbers.has(clean)) {
    return {
      ok: false,
      phone: clean,
      message: "Sallamasyon telefon numarası kabul edilmiyor."
    };
  }

  // Son 7 hanesi hep aynıysa engelle
  if (/^(\d)\1{6,}$/.test(clean.slice(-7))) {
    return {
      ok: false,
      phone: clean,
      message: "Geçerli bir telefon numarası yazmalısın."
    };
  }

  return {
    ok: true,
    phone: clean,
    message: ""
  };
}


function normalizeForWordCheck(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function chatRevealsWord(message, word) {
  const normalizedMessage = normalizeForWordCheck(message);
  const normalizedWord = normalizeForWordCheck(word);

  if (!normalizedMessage || !normalizedWord) return false;

  // kedi, ke-di, ke di, k e d i gibi kelimeyi parçalayıp yazmayı engeller.
  if (normalizedMessage.includes(normalizedWord)) return true;

  // Kelime çok kısa ise harfleri tek tek ifşa etmeyi de engelle.
  if (normalizedWord.length <= 4) {
    const letters = normalizedWord.split("");
    const messageLetters = normalizedMessage.split("");

    let index = 0;
    for (const letter of messageLetters) {
      if (letter === letters[index]) index++;
      if (index >= letters.length) return true;
    }
  }

  return false;
}


function normalizeForWordCheck(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function removeTurkishVowels(text) {
  return String(text || "").replace(/[aeiou]/g, "");
}

function longestCommonSubsequenceLength(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[a.length][b.length];
}

function containsOrderedLetters(message, word, allowedMissing = 0) {
  let wordIndex = 0;

  for (const char of message) {
    if (char === word[wordIndex]) {
      wordIndex++;
      if (wordIndex >= word.length - allowedMissing) return true;
    }
  }

  return wordIndex >= word.length - allowedMissing;
}

function chatRevealsWord(message, word) {
  const normalizedMessage = normalizeForWordCheck(message);
  const normalizedWord = normalizeForWordCheck(word);

  if (!normalizedMessage || !normalizedWord) return false;

  // Doğru kelimenin ilk 3 veya 4 harfiyle başlayan mesajlar kopya ipucu sayılır.
  const prefixLength = normalizedWord.length >= 4 ? 4 : 3;
  const shorterPrefix = normalizedWord.slice(0, Math.min(3, normalizedWord.length));
  const longerPrefix = normalizedWord.slice(0, Math.min(prefixLength, normalizedWord.length));
  if (
    normalizedMessage.length >= 3 &&
    (normalizedMessage.startsWith(shorterPrefix) || normalizedMessage.startsWith(longerPrefix))
  ) return true;

  // Direkt kelime: bilgisayar / b-i-l-g-i-s-a-y-a-r / bi l gi sa yar
  if (normalizedMessage.includes(normalizedWord)) return true;

  // Kelime başına/sonuna başka harf koyma: xxbilgisayarxx
  if (normalizedMessage.indexOf(normalizedWord) !== -1) return true;

  const wordLength = normalizedWord.length;

  // Ünlüleri atarak yazma: blgsyr, b l g s y r
  const messageSkeleton = removeTurkishVowels(normalizedMessage);
  const wordSkeleton = removeTurkishVowels(normalizedWord);

  if (wordSkeleton.length >= 3 && messageSkeleton.includes(wordSkeleton)) {
    return true;
  }

  // Eksik harfle yazma: bilgisyr, bilgsayar, blgisayr
  const lcs = longestCommonSubsequenceLength(normalizedMessage, normalizedWord);
  const ratio = lcs / wordLength;

  if (wordLength <= 4) {
    // kısa kelimelerde daha sıkı: kedi => kedi / k e d i / ke-di engellenir
    if (lcs >= wordLength) return true;
    if (containsOrderedLetters(normalizedMessage, normalizedWord, 0)) return true;
  } else if (wordLength <= 7) {
    // orta kelime: en fazla 1 harf eksikse engelle
    if (lcs >= wordLength - 1 && normalizedMessage.length <= wordLength + 4) return true;
    if (containsOrderedLetters(normalizedMessage, normalizedWord, 1)) return true;
  } else {
    // uzun kelime: bilgisayar -> bi l gi syr gibi eksik/bozuk yazımları engelle
    const allowedMissing = Math.max(1, Math.floor(wordLength * 0.25));
    if (lcs >= wordLength - allowedMissing && normalizedMessage.length <= wordLength + 5) return true;
    if (ratio >= 0.72 && normalizedMessage.length <= wordLength + 6) return true;
    if (containsOrderedLetters(normalizedMessage, normalizedWord, allowedMissing)) return true;
  }

  // İlk + son ve iskelet benzerliği: blg...syr gibi ipucu verme
  if (
    wordSkeleton.length >= 4 &&
    messageSkeleton.length >= Math.max(3, wordSkeleton.length - 2)
  ) {
    const skeletonLcs = longestCommonSubsequenceLength(messageSkeleton, wordSkeleton);
    if (skeletonLcs >= wordSkeleton.length - 1) return true;
  }

  return false;
}


function levenshteinDistance(a, b) {
  a = String(a || "");
  b = String(b || "");

  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function guessLooksClose(message, word) {
  const guess = normalizeForWordCheck(message);
  const target = normalizeForWordCheck(word);

  if (!guess || !target || guess === target) return false;
  if (target.length < 3) return false;

  const distance = levenshteinDistance(guess, target);
  const maxLength = Math.max(guess.length, target.length);
  const similarity = maxLength > 0 ? 1 - (distance / maxLength) : 0;

  // Bir harf eksik/fazla/yanlış her zaman yakın kabul edilir.
  if (distance === 1) return true;

  // Diğer durumlarda en az %80 benzerlik gerekir.
  return similarity >= 0.80;
}

function shouldPlayNearMiss(player, cleanMessage, word) {
  if (!player || !guessLooksClose(cleanMessage, word)) return false;

  const normalizedGuess = normalizeForWordCheck(cleanMessage);
  const now = Date.now();

  if (!player.nearMiss) {
    player.nearMiss = {
      lastAt: 0,
      lastGuess: ""
    };
  }

  // Aynı oyuncu aynı yakın tahmini spamlamasın
  if (player.nearMiss.lastGuess === normalizedGuess && now - player.nearMiss.lastAt < 8000) {
    return false;
  }

  // Genel cooldown
  if (now - player.nearMiss.lastAt < 2500) {
    return false;
  }

  player.nearMiss.lastAt = now;
  player.nearMiss.lastGuess = normalizedGuess;
  return true;
}



function ensureUserSocialFields(user) {
  if (!user) return;
  if (!Array.isArray(user.friends)) user.friends = [];
  if (!Array.isArray(user.friendRequests)) user.friendRequests = [];
  if (!Array.isArray(user.sentFriendRequests)) user.sentFriendRequests = [];
  if (!Array.isArray(user.blockedUsers)) user.blockedUsers = [];
}

function findUserByUsername(username) {
  const clean = String(username || "").trim().toLowerCase();
  return authDb.users.find((user) => (
    String(user.username || "").toLowerCase() === clean ||
    String(user.displayName || "").toLowerCase() === clean
  )) || null;
}

function publicFriendUser(user) {
  return user ? {
    id: user.id,
    username: user.isAdmin === true ? (user.displayName || ADMIN_DISPLAY_NAME) : user.username,
    weeklyScore: user.weeklyScore || 0,
    totalScore: user.totalScore || 0
  } : null;
}

function getFriendsPayload(user) {
  ensureUserSocialFields(user);

  const friends = user.friends
    .map((id) => authDb.users.find((item) => item.id === id))
    .filter(Boolean)
    .map(publicFriendUser);

  const requests = user.friendRequests
    .map((id) => authDb.users.find((item) => item.id === id))
    .filter(Boolean)
    .map(publicFriendUser);

  const sentRequests = user.sentFriendRequests
    .map((id) => authDb.users.find((item) => item.id === id))
    .filter(Boolean)
    .map(publicFriendUser);

  const blockedUsers = user.blockedUsers
    .map((id) => authDb.users.find((item) => item.id === id))
    .filter(Boolean)
    .map(publicFriendUser);

  return { 
    friends, 
    requests,
    sentRequests,
    blockedUsers,
    requestCount: requests.length
  };
}



function getUserById(userId) {
  return authDb.users.find((user) => user.id === userId) || null;
}

function hasBlockedSender(receiverUserId, senderUserId) {
  if (!receiverUserId || !senderUserId) return false;

  const receiver = getUserById(receiverUserId);
  if (!receiver) return false;

  ensureUserSocialFields(receiver);
  return receiver.blockedUsers.includes(senderUserId);
}

function emitToRoomRespectingBlocks(room, eventName, payload, senderUserId) {
  if (!room || !Array.isArray(room.players)) return;

  room.players.forEach((receiverPlayer) => {
    if (hasBlockedSender(receiverPlayer.userId, senderUserId)) {
      return;
    }

    io.to(receiverPlayer.id).emit(eventName, payload);
  });
}

function emitSoundToRoomRespectingBlocks(room, soundName, senderUserId, exceptSocketId = null) {
  if (!room || !Array.isArray(room.players) || !soundName) return;

  room.players.forEach((receiverPlayer) => {
    if (exceptSocketId && receiverPlayer.id === exceptSocketId) {
      return;
    }

    if (hasBlockedSender(receiverPlayer.userId, senderUserId)) {
      return;
    }

    io.to(receiverPlayer.id).emit("playSound", soundName);
  });
}


function safePublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    birthDay: user.birthDay,
    birthMonth: user.birthMonth,
    birthYear: user.birthYear,
    phone: user.phone,
    weeklyScore: user.weeklyScore || 0,
    totalScore: user.totalScore || 0,
    provider: user.provider || "local",
    isAdmin: user.isAdmin === true,
    displayName: user.isAdmin === true ? (user.displayName || "SFD SKETCH") : user.username
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, oldHash] = stored.split(":");
  const newHash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(oldHash, "hex"), Buffer.from(newHash, "hex"));
}

const ADMIN_USERNAME = "admin";
const ADMIN_DISPLAY_NAME = "SFD SKETCH";
const ADMIN_DEFAULT_PASSWORD = String(process.env.SFD_ADMIN_PASSWORD || "ser1dar55");
const ADMIN_USER_ID = "sfd-sketch-root-admin";

function ensureAdminAccount() {
  let admin = authDb.users.find((user) => user && (user.id === ADMIN_USER_ID || String(user.username || "").toLowerCase() === ADMIN_USERNAME));
  if (!admin) {
    admin = {
      id: ADMIN_USER_ID,
      username: ADMIN_USERNAME,
      email: "admin@sfdsketch.local",
      firstName: "SFD",
      lastName: "SKETCH",
      birthDay: 1,
      birthMonth: 1,
      birthYear: 1990,
      phone: "admin",
      provider: "local",
      emailVerified: true,
      phoneVerified: true,
      weeklyScore: 0,
      totalScore: 0,
      createdAt: new Date().toISOString()
    };
    authDb.users.push(admin);
  }

  admin.id = ADMIN_USER_ID;
  admin.username = ADMIN_USERNAME;
  admin.displayName = ADMIN_DISPLAY_NAME;
  admin.isAdmin = true;
  admin.emailVerified = true;
  admin.phoneVerified = true;
  admin.passwordHash = hashPassword(ADMIN_DEFAULT_PASSWORD);
  if (!admin.email) admin.email = "admin@sfdsketch.local";
  if (!admin.provider) admin.provider = "local";
  if (!Array.isArray(admin.blockedUsers)) admin.blockedUsers = [];
  saveDb(authDb);
  return admin;
}

function normalizeClientIp(value) {
  let raw = Array.isArray(value) ? String(value[0] || "") : String(value || "");
  raw = raw.trim();
  if (!raw) return "unknown";

  // RFC 7239 Forwarded başlığındaki for= değerini de destekle.
  const forwardedMatch = raw.match(/(?:^|[;,\s])for=(?:"?)(\[[^\]]+\]|[^;,\s"]+)/i);
  if (forwardedMatch) raw = forwardedMatch[1];

  // Birden fazla proxy adresi varsa soldaki ilk geçerli istemci adresi ayrı işlenir.
  raw = raw.split(",")[0].trim().replace(/^"|"$/g, "");
  if (!raw || raw.toLowerCase() === "unknown") return "unknown";

  // [IPv6]:port biçimini temizle.
  if (raw.startsWith("[")) {
    const closing = raw.indexOf("]");
    if (closing > 0) raw = raw.slice(1, closing);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)) {
    raw = raw.replace(/:\d+$/, "");
  }

  raw = raw.replace(/^::ffff:/i, "").replace(/%[0-9A-Za-z_.-]+$/, "").trim();
  return net.isIP(raw) !== 0 ? raw.toLowerCase() : "unknown";
}

function isLoopbackIp(value) {
  const ip = normalizeClientIp(value);
  if (ip === "unknown") return false;
  return ip === "::1" || ip === "0.0.0.0" || ip === "::" || ip.startsWith("127.");
}

function isUsableClientIp(value) {
  const ip = normalizeClientIp(value);
  return ip !== "unknown" && net.isIP(ip) !== 0 && !isLoopbackIp(ip);
}

function splitIpCandidates(value) {
  if (Array.isArray(value)) return value.flatMap(splitIpCandidates);
  const raw = String(value || "").trim();
  if (!raw) return [];

  const forwardedValues = [];
  const regex = /(?:^|[;,\s])for=(?:"?)(\[[^\]]+\]|[^;,\s"]+)/ig;
  let match;
  while ((match = regex.exec(raw))) forwardedValues.push(match[1]);
  if (forwardedValues.length) return forwardedValues;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function pickUsableClientIp(...values) {
  for (const value of values) {
    for (const candidate of splitIpCandidates(value)) {
      const ip = normalizeClientIp(candidate);
      if (isUsableClientIp(ip)) return ip;
    }
  }
  return "unknown";
}

function getHeaderClientIp(headers = {}) {
  return pickUsableClientIp(
    headers["cf-connecting-ip"],
    headers["true-client-ip"],
    headers["fly-client-ip"],
    headers["x-vercel-forwarded-for"],
    headers["x-real-ip"],
    headers["x-client-ip"],
    headers["x-forwarded-for"],
    headers.forwarded
  );
}

function getRequestIp(req) {
  const headerIp = getHeaderClientIp(req && req.headers || {});
  if (headerIp !== "unknown") return headerIp;
  return pickUsableClientIp(
    req && req.ip,
    req && req.socket && req.socket.remoteAddress,
    req && req.connection && req.connection.remoteAddress
  );
}

function getSocketIp(socket) {
  const headers = socket && socket.handshake && socket.handshake.headers || socket && socket.request && socket.request.headers || {};
  const headerIp = getHeaderClientIp(headers);
  if (headerIp !== "unknown") return headerIp;
  return pickUsableClientIp(
    socket && socket.handshake && socket.handshake.address,
    socket && socket.conn && socket.conn.remoteAddress,
    socket && socket.request && socket.request.socket && socket.request.socket.remoteAddress
  );
}


function pickAnyClientIp(...values) {
  for (const value of values) {
    for (const candidate of splitIpCandidates(value)) {
      const ip = normalizeClientIp(candidate);
      if (ip !== "unknown" && net.isIP(ip) !== 0) return ip;
    }
  }
  return "unknown";
}

function getRequestRawIp(req) {
  return pickAnyClientIp(
    req && req.headers && req.headers["cf-connecting-ip"],
    req && req.headers && req.headers["true-client-ip"],
    req && req.headers && req.headers["x-real-ip"],
    req && req.headers && req.headers["x-forwarded-for"],
    req && req.headers && req.headers.forwarded,
    req && req.ip,
    req && req.socket && req.socket.remoteAddress,
    req && req.connection && req.connection.remoteAddress
  );
}

function getSocketRawIp(socket) {
  const headers = socket && socket.handshake && socket.handshake.headers || socket && socket.request && socket.request.headers || {};
  return pickAnyClientIp(
    headers["cf-connecting-ip"],
    headers["true-client-ip"],
    headers["x-real-ip"],
    headers["x-forwarded-for"],
    headers.forwarded,
    socket && socket.handshake && socket.handshake.address,
    socket && socket.conn && socket.conn.remoteAddress,
    socket && socket.request && socket.request.socket && socket.request.socket.remoteAddress
  );
}

function isLocalHostHeader(headers = {}) {
  const rawHost = String(headers.host || headers[":authority"] || "").trim().toLowerCase();
  const host = rawHost.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "");
  return host === "localhost" || host === "::1" || host === "0.0.0.0" || host.startsWith("127.");
}

function getRequestNetworkScope(req) {
  const rawIp = getRequestRawIp(req);
  if (isLoopbackIp(rawIp) && isLocalHostHeader(req && req.headers || {})) return "local-loopback";
  return "";
}

function getSocketNetworkScope(socket) {
  const headers = socket && socket.handshake && socket.handshake.headers || socket && socket.request && socket.request.headers || {};
  const rawIp = getSocketRawIp(socket);
  if (isLoopbackIp(rawIp) && isLocalHostHeader(headers)) return "local-loopback";
  return "";
}

function normalizeDeviceId(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{16,96}$/.test(clean) ? clean : "";
}

function getRequestDeviceId(req) {
  return normalizeDeviceId(req && req.headers && req.headers["x-sfd-device-id"]);
}

function getSocketDeviceId(socket) {
  return normalizeDeviceId(
    socket && socket.handshake && socket.handshake.auth && socket.handshake.auth.deviceId ||
    socket && socket.handshake && socket.handshake.headers && socket.handshake.headers["x-sfd-device-id"]
  );
}

function ensureAdminBanStore() {
  if (!authDb.settings) authDb.settings = {};
  if (!authDb.settings.adminBans || typeof authDb.settings.adminBans !== "object") {
    authDb.settings.adminBans = { users: {}, ips: {}, devices: {}, networks: {}, audit: [] };
  }
  const store = authDb.settings.adminBans;
  if (!store.users || typeof store.users !== "object") store.users = {};
  if (!store.ips || typeof store.ips !== "object") store.ips = {};
  if (!store.devices || typeof store.devices !== "object") store.devices = {};
  if (!store.networks || typeof store.networks !== "object") store.networks = {};
  if (!Array.isArray(store.audit)) store.audit = [];
  return store;
}

function cleanupExpiredAdminBans() {
  const store = ensureAdminBanStore();
  const now = Date.now();
  let changed = false;
  for (const bucketName of ["users", "ips", "devices", "networks"]) {
    for (const [key, ban] of Object.entries(store[bucketName])) {
      const until = Number(ban && ban.until || 0);
      const invalidIpBan = bucketName === "ips" && !isUsableClientIp((ban && ban.ip) || key);
      const invalidDeviceBan = bucketName === "devices" && !normalizeDeviceId((ban && ban.deviceId) || key);
      const invalidNetworkBan = bucketName === "networks" && !String((ban && ban.networkScope) || key || "").trim();
      if (invalidIpBan || invalidDeviceBan || invalidNetworkBan || (until > 0 && until <= now)) {
        delete store[bucketName][key];
        changed = true;
      }
    }
  }
  if (changed) saveDb(authDb);
  return store;
}

function getActiveAdminBan(user, ip, deviceId, networkScope = "") {
  if (user && user.isAdmin === true) return null;
  const store = cleanupExpiredAdminBans();
  const userBan = user && store.users[String(user.id || "")];
  const normalizedIp = normalizeClientIp(ip);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const normalizedNetworkScope = String(networkScope || "").trim().toLowerCase();
  const ipBan = isUsableClientIp(normalizedIp) ? store.ips[normalizedIp] : null;
  const networkBan = normalizedNetworkScope ? store.networks[normalizedNetworkScope] : null;
  const deviceBan = normalizedDeviceId ? store.devices[normalizedDeviceId] : null;
  const ban = userBan || ipBan || networkBan || deviceBan || null;
  if (!ban) return null;
  const until = Number(ban.until || 0);
  return { ...ban, remainingMs: until > 0 ? Math.max(0, until - Date.now()) : 0 };
}

function formatAdminBanMessage(ban) {
  if (!ban) return "Bu hesaba erişim engellendi.";
  const reason = String(ban.reason || "Yönetici kararı");
  const until = Number(ban.until || 0);
  if (!until) return `Kalıcı olarak yasaklandın. Sebep: ${reason}`;
  return `Geçici olarak yasaklandın. Kalan süre: ${formatPenaltyDuration(Math.max(0, until - Date.now()))}. Sebep: ${reason}`;
}

function invalidateUserTokens(userId) {
  let changed = false;
  Object.keys(authDb.tokens || {}).forEach((token) => {
    if (authDb.tokens[token] && authDb.tokens[token].userId === userId) {
      delete authDb.tokens[token];
      changed = true;
    }
  });
  return changed;
}

function addAdminAudit(action, details = {}) {
  const store = ensureAdminBanStore();
  store.audit.unshift({ action, details, at: new Date().toISOString() });
  store.audit = store.audit.slice(0, 250);
}

ensureAdminAccount();
cleanupExpiredAdminBans();

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function clearPasswordResetFields(user) {
  if (!user) return;
  delete user.passwordResetTokenHash;
  delete user.passwordResetExpiresAt;
}

function findUserByValidResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const tokenHash = hashResetToken(token);
  const now = Date.now();

  return authDb.users.find((user) => (
    user.passwordResetTokenHash === tokenHash &&
    Number(user.passwordResetExpiresAt || 0) > now
  )) || null;
}

function parseCookieHeader(header = "") {
  const cookies = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return cookies;
}

function resetWeeklyScoresIfNeeded() {
  const currentKey = getIstanbulWeekKey(new Date());
  if (!authDb.settings) authDb.settings = {};

  if (!authDb.settings.weeklyResetKey) {
    authDb.settings.weeklyResetKey = currentKey;
    saveDb(authDb);
    return;
  }

  if (authDb.settings.weeklyResetKey !== currentKey) {
    authDb.users.forEach((user) => {
      user.weeklyScore = 0;
    });
    authDb.settings.weeklyResetKey = currentKey;
    saveDb(authDb);
    console.log("[SFD] Haftalık puanlar pazar 00:00 sonrası sıfırlandı:", currentKey);
  }
}

function getUserByToken(token) {
  resetWeeklyScoresIfNeeded();
  if (!token || !authDb.tokens[token]) return null;
  return authDb.users.find((user) => user.id === authDb.tokens[token].userId) || null;
}

function getUserFromReq(req) {
  return getUserByToken(parseCookieHeader(req.headers.cookie || "")[TOKEN_COOKIE]);
}

function getUserFromSocket(socket) {
  return getUserByToken(parseCookieHeader(socket.handshake.headers.cookie || "")[TOKEN_COOKIE]);
}

async function sendVerificationCodes(user) {
  user.emailCode = makeCode();
  user.emailCodeExpiresAt = Date.now() + VERIFY_CODE_TTL_MS;
  user.lastEmailCodeSentAt = Date.now();

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.log("\n[SFD MAIL AYARI EKSİK]");
    console.log("MAIL_USER ve MAIL_PASS .env dosyasında yok.");
    console.log(`E-posta kodu (${user.email}): ${user.emailCode}`);
    console.log(`Telefon kayıt bilgisi: ${user.phone}\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `"SFD Sketch" <${process.env.MAIL_USER}>`,
    to: user.email,
    subject: "SFD Sketch Doğrulama Kodun",
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5">
        <div style="max-width:520px;margin:auto;background:#fff;border:1px solid #ddd;padding:22px;border-radius:8px">
          <h2 style="margin-top:0;color:#111">SFD Sketch</h2>
          <p>Merhaba <b>${user.firstName || user.username}</b>,</p>
          <p>Oyuna kayıt işlemini tamamlamak için doğrulama kodun:</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:5px;color:#c40000;margin:18px 0">
            ${user.emailCode}
          </div>
          <p>Bu kod 10 dakika geçerlidir.</p>
          <p style="font-size:12px;color:#777">Bu işlemi sen yapmadıysan bu maili yok sayabilirsin.</p>
        </div>
      </div>
    `
  });
}

async function sendPasswordResetEmail(user, resetLink) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.log("\n[SFD ŞİFRE SIFIRLAMA MAIL AYARI EKSİK]");
    console.log("MAIL_USER ve MAIL_PASS .env dosyasında yok.");
    console.log(`Şifre sıfırlama bağlantısı (${user.email}): ${resetLink}\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `"SFD Sketch" <${process.env.MAIL_USER}>`,
    to: user.email,
    subject: "SFD Sketch Şifre Sıfırlama Bağlantısı",
    html: `
      <div style="font-family:Arial,sans-serif;padding:20px;background:#f3f7fb">
        <div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #d7e1ec;padding:24px;border-radius:12px">
          <h2 style="margin:0 0 10px;color:#10233b">SFD Sketch</h2>
          <p>Merhaba <b>${user.firstName || user.username}</b>,</p>
          <p>Hesabının şifresini yenilemek için aşağıdaki düğmeye bas:</p>
          <p style="margin:24px 0">
            <a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#20b98d;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Yeni Şifre Belirle</a>
          </p>
          <p style="font-size:13px;color:#566579;word-break:break-all">Bağlantı: ${resetLink}</p>
          <p style="font-size:13px;color:#566579">Bu bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p>
          <p style="font-size:12px;color:#8290a3">Bu işlemi sen istemediysen e-postayı yok sayabilirsin; mevcut şifren değişmez.</p>
        </div>
      </div>
    `
  });
}


function addScoreToUser(userId, points) {
  resetWeeklyScoresIfNeeded();
  const user = authDb.users.find((item) => item.id === userId);
  if (!user) return;
  user.weeklyScore = (user.weeklyScore || 0) + points;
  user.totalScore = (user.totalScore || 0) + points;
  saveDb(authDb);
}

function deductTop10ScoreFromUser(userId, points) {
  resetWeeklyScoresIfNeeded();
  const user = authDb.users.find((item) => item.id === userId);
  if (!user) return { deducted: 0, remaining: 0 };

  const requested = Math.max(0, Number(points || 0));
  const current = Math.max(0, Number(user.weeklyScore || 0));
  const deducted = Math.min(current, requested);
  user.weeklyScore = Math.max(0, current - requested);
  saveDb(authDb);

  return {
    deducted,
    remaining: user.weeklyScore
  };
}

function formatPenaltyDuration(ms) {
  const totalSeconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days) parts.push(`${days} gün`);
  if (hours) parts.push(`${hours} saat`);
  if (minutes) parts.push(`${minutes} dakika`);
  if (!days && !hours && minutes < 2 && seconds) parts.push(`${seconds} saniye`);

  return parts.join(" ") || "1 dakika";
}

function getActiveAfkRoomBlock(user, roomId) {
  if (!user || !roomId) return null;
  const records = user.afkRoomKickPenalties && typeof user.afkRoomKickPenalties === "object"
    ? user.afkRoomKickPenalties
    : {};
  const record = records[roomId];
  if (!record) return null;

  const blockedUntil = Math.max(0, Number(record.blockedUntil || 0));
  const remainingMs = blockedUntil - Date.now();
  if (remainingMs <= 0) return null;

  return {
    ...record,
    blockedUntil,
    remainingMs
  };
}

function registerAfkRoomKickPenalty(userId, roomId) {
  const user = authDb.users.find((item) => item.id === userId);
  if (!user || !roomId) {
    return { kickCount: 1, durationMs: 5 * 60 * 1000, blockedUntil: Date.now() + (5 * 60 * 1000) };
  }

  if (!user.afkRoomKickPenalties || typeof user.afkRoomKickPenalties !== "object") {
    user.afkRoomKickPenalties = {};
  }

  const todayKey = getIstanbulDayKey(new Date());
  const previous = user.afkRoomKickPenalties[roomId] || {};
  const previousCount = previous.dayKey === todayKey
    ? Math.max(0, Number(previous.kickCount || 0))
    : 0;
  const kickCount = previousCount + 1;
  const durationMs = 5 * 60 * 1000 * Math.pow(5, kickCount - 1);
  const blockedUntil = Date.now() + durationMs;

  user.afkRoomKickPenalties[roomId] = {
    dayKey: todayKey,
    kickCount,
    durationMs,
    blockedUntil,
    updatedAt: new Date().toISOString()
  };

  saveDb(authDb);

  return {
    kickCount,
    durationMs,
    blockedUntil
  };
}

function awardGlobalTop3Players(room) {
  if (!room || room.type !== "global") return;

  const sortedPlayers = [...room.players]
    .filter((player) => player.userId && player.isAdmin !== true)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const scoreSettings = getScoreSettings();
  const uniqueScores = [...new Set(
    sortedPlayers
      .map((player) => Number(player.score || 0))
      .filter((score) => score > 0)
  )].sort((a, b) => b - a).slice(0, scoreSettings.globalAwardRankGroups);

  if (!uniqueScores.length) return;

  const awardedPlayers = sortedPlayers.filter((player) => uniqueScores.includes(Number(player.score || 0)));

  awardedPlayers.forEach((player) => {
    const points = Math.max(0, Number(player.score || 0));
    const scoreRank = uniqueScores.indexOf(points) + 1;

    addScoreToUser(player.userId, points);
});
}

function resetRoomScores(room) {
  if (!room || !Array.isArray(room.players)) return;
  room.players.forEach((player) => {
    player.score = 0;
  });
  resetTurnScoring(room, null);
}

function getLeaderboard(limit = 10) {
  resetWeeklyScoresIfNeeded();
  return [...authDb.users]
    .filter((user) => user.emailVerified && user.isAdmin !== true)
    .sort((a, b) => (b.weeklyScore || 0) - (a.weeklyScore || 0))
    .map((user, index) => ({
      rank: index + 1,
      username: user.displayName || user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      weeklyScore: user.weeklyScore || 0,
      totalScore: user.totalScore || 0
    }))
    .slice(0, limit);
}

function getUserRank(userId) {
  const rankedUsers = [...authDb.users]
    .filter((user) => user.emailVerified && user.isAdmin !== true)
    .sort((a, b) => (b.weeklyScore || 0) - (a.weeklyScore || 0));

  const index = rankedUsers.findIndex((user) => user.id === userId);
  return index === -1 ? null : index + 1;
}

setInterval(resetWeeklyScoresIfNeeded, 60 * 1000);



app.post("/api/register", async (req, res) => {
  try {
    resetWeeklyScoresIfNeeded();

    const username = String(req.body.username || "").trim().slice(0, 18);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const passwordAgain = String(req.body.passwordAgain || "");
    const firstName = String(req.body.firstName || "").trim().slice(0, 40);
    const lastName = String(req.body.lastName || "").trim().slice(0, 40);
    const birthCheck = validateBirthDate(req.body.birthDay, req.body.birthMonth, req.body.birthYear);
    const birthYear = birthCheck.birthYear;
    const birthDay = birthCheck.birthDay;
    const birthMonth = birthCheck.birthMonth;
    const phoneCheck = validateTurkishPhone(req.body.phone);
    const phone = phoneCheck.phone;

    if (!username || !email || !password || !passwordAgain || !firstName || !lastName || !birthCheck.ok || !phone) {
      res.status(400).json({ ok: false, message: "Tüm alanları doldurmalısın." });
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ ok: false, message: "Geçerli e-posta yaz." });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ ok: false, message: "Şifre en az 6 karakter olmalı." });
      return;
    }

    if (password !== passwordAgain) {
      res.status(400).json({ ok: false, message: "Şifreler aynı değil." });
      return;
    }

    if (!birthCheck.ok) {
      res.status(400).json({ ok: false, message: birthCheck.message });
      return;
    }

    if (!phoneCheck.ok) {
      res.status(400).json({ ok: false, message: phoneCheck.message });
      return;
    }

    if (authDb.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      res.status(409).json({ ok: false, message: "Bu kullanıcı adı alınmış." });
      return;
    }

    if (authDb.users.some((user) => user.email === email)) {
      res.status(409).json({ ok: false, message: "Bu e-posta zaten kayıtlı." });
      return;
    }

    if (authDb.users.some((user) => user.phone === phone)) {
      res.status(409).json({ ok: false, message: "Bu telefon zaten kayıtlı." });
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      email,
      passwordHash: hashPassword(password),
      firstName,
      lastName,
      birthDay,
      birthMonth,
      birthYear,
      phone,
      provider: "local",
      emailVerified: false,
      phoneVerified: true,
      weeklyScore: 0,
      totalScore: 0,
      createdAt: new Date().toISOString()
    };

    await sendVerificationCodes(user);
    authDb.users.push(user);
    saveDb(authDb);

    res.json({
      ok: true,
      message: "Kayıt oluşturuldu. E-posta doğrulama kodu mail adresine gönderildi.",
      userId: user.id
    });
  } catch (error) {
    console.error("Kayıt hatası:", error);
    res.status(500).json({ ok: false, message: "Mail gönderilemedi veya kayıt sırasında hata oldu: " + error.message });
  }
});

app.post("/api/verify", (req, res) => {
  const userId = String(req.body.userId || "");
  const emailCode = String(req.body.emailCode || "").trim();
  const user = authDb.users.find((item) => item.id === userId);
  if (!user) {
    res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });
    return;
  }

  const now = Date.now();

  if (!emailCode || user.emailCode !== emailCode || now > (user.emailCodeExpiresAt || 0)) {
    res.status(400).json({ ok: false, message: "E-posta kodu yanlış veya süresi dolmuş." });
    return;
  }

  user.emailVerified = true;
  user.phoneVerified = true;
  delete user.emailCode;
  delete user.emailCodeExpiresAt;
  delete user.phoneCodeExpiresAt;

  const token = makeToken();
  authDb.tokens[token] = {
    userId: user.id,
    createdAt: new Date().toISOString()
  };

  saveDb(authDb);

  res.setHeader("Set-Cookie", `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  res.json({ ok: true, user: safePublicUser(user), rank: getUserRank(user.id) });
});

app.post("/api/password-reset/request", async (req, res) => {
  const genericMessage = "Bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi.";

  try {
    const email = normalizeEmail(req.body.email);

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi yazmalısın." });
      return;
    }

    const user = authDb.users.find((item) => item.email === email);

    // Hesap bilgisini dışarı sızdırmamak için bulunamayan e-postada da aynı yanıt verilir.
    if (!user) {
      res.json({ ok: true, message: genericMessage });
      return;
    }

    const now = Date.now();
    const lastSentAt = Number(user.lastPasswordResetSentAt || 0);
    const waitMs = PASSWORD_RESET_COOLDOWN_MS - (now - lastSentAt);

    if (waitMs > 0) {
      res.status(429).json({
        ok: false,
        retryAfterMs: waitMs,
        message: `Yeni bağlantı istemek için ${Math.ceil(waitMs / 1000)} saniye beklemelisin.`
      });
      return;
    }

    const rawToken = makeToken();
    user.passwordResetTokenHash = hashResetToken(rawToken);
    user.passwordResetExpiresAt = now + PASSWORD_RESET_TTL_MS;
    user.lastPasswordResetSentAt = now;

    const resetLink = `${getPublicBaseUrl(req)}/?reset=${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail(user, resetLink);
    saveDb(authDb);

    res.json({ ok: true, message: genericMessage });
  } catch (error) {
    console.error("Şifre sıfırlama bağlantısı gönderme hatası:", error);
    res.status(500).json({ ok: false, message: "Şifre sıfırlama e-postası gönderilemedi: " + error.message });
  }
});

app.get("/api/password-reset/validate", (req, res) => {
  const user = findUserByValidResetToken(req.query.token);

  if (!user) {
    res.status(400).json({ ok: false, message: "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş." });
    return;
  }

  res.json({ ok: true, message: "Bağlantı geçerli." });
});

app.post("/api/password-reset/complete", (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    const passwordAgain = String(req.body.passwordAgain || "");
    const user = findUserByValidResetToken(token);

    if (!user) {
      res.status(400).json({ ok: false, message: "Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş." });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ ok: false, message: "Yeni şifre en az 6 karakter olmalı." });
      return;
    }

    if (password !== passwordAgain) {
      res.status(400).json({ ok: false, message: "Yeni şifreler aynı değil." });
      return;
    }

    user.passwordHash = hashPassword(password);
    user.passwordChangedAt = new Date().toISOString();
    clearPasswordResetFields(user);

    // Şifre değişince diğer açık oturumları kapat.
    Object.keys(authDb.tokens).forEach((authToken) => {
      if (authDb.tokens[authToken] && authDb.tokens[authToken].userId === user.id) {
        delete authDb.tokens[authToken];
      }
    });

    saveDb(authDb);
    res.json({ ok: true, message: "Şifren yenilendi. Yeni şifrenle giriş yapabilirsin." });
  } catch (error) {
    console.error("Şifre yenileme hatası:", error);
    res.status(500).json({ ok: false, message: "Şifre yenilenemedi: " + error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    resetWeeklyScoresIfNeeded();

    const login = String(req.body.login || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = authDb.users.find((item) => item.email === login || item.username.toLowerCase() === login);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ ok: false, message: "Giriş bilgileri yanlış." });
      return;
    }

    const activeAdminBan = getActiveAdminBan(user, getRequestIp(req), getRequestDeviceId(req), getRequestNetworkScope(req));
    if (activeAdminBan) {
      res.status(403).json({ ok: false, banned: true, message: formatAdminBanMessage(activeAdminBan) });
      return;
    }

    if (!user.emailVerified) {
      const now = Date.now();
      const lastSentAt = user.lastEmailCodeSentAt || 0;
      const resendAfterMs = Math.max(0, RESEND_CODE_COOLDOWN_MS - (now - lastSentAt));

      res.status(403).json({
        ok: false,
        needsVerification: true,
        userId: user.id,
        resendAfterMs,
        message: "Hesap doğrulanmamış. Kod otomatik gönderilmedi. Kod gelmediyse 1 dakika dolunca tekrar kod gönder butonuna bas."
      });
      return;
    }

    const loginIp = getRequestIp(req);
    if (isUsableClientIp(loginIp)) {
      user.lastKnownIp = normalizeClientIp(loginIp);
      user.lastKnownIpAt = new Date().toISOString();
    }
    const loginDeviceId = getRequestDeviceId(req);
    if (loginDeviceId) {
      user.lastKnownDeviceId = loginDeviceId;
      user.lastKnownDeviceAt = new Date().toISOString();
    }

    const token = makeToken();
    authDb.tokens[token] = {
      userId: user.id,
      createdAt: new Date().toISOString()
    };
    saveDb(authDb);

    res.setHeader("Set-Cookie", `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
    res.json({ ok: true, user: safePublicUser(user), rank: getUserRank(user.id) });
  } catch (error) {
    console.error("Giriş/mail hatası:", error);
    res.status(500).json({ ok: false, message: "Giriş sırasında hata oldu: " + error.message });
  }
});


app.post("/api/resend-code", async (req, res) => {
  try {
    const userId = String(req.body.userId || "");
    const user = authDb.users.find((item) => item.id === userId);

    if (!user) {
      res.status(404).json({ ok: false, message: "Kullanıcı bulunamadı." });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ ok: false, message: "Bu hesap zaten doğrulanmış." });
      return;
    }

    const now = Date.now();
    const lastSentAt = user.lastEmailCodeSentAt || 0;
    const diff = now - lastSentAt;

    if (diff < RESEND_CODE_COOLDOWN_MS) {
      res.status(429).json({
        ok: false,
        resendAfterMs: RESEND_CODE_COOLDOWN_MS - diff,
        message: "Tekrar kod göndermek için biraz beklemelisin."
      });
      return;
    }

    await sendVerificationCodes(user);
    saveDb(authDb);

    res.json({
      ok: true,
      resendAfterMs: RESEND_CODE_COOLDOWN_MS,
      message: "Yeni doğrulama kodu mail adresine gönderildi."
    });
  } catch (error) {
    console.error("Tekrar kod gönderme hatası:", error);
    res.status(500).json({ ok: false, message: "Kod gönderilemedi: " + error.message });
  }
});


app.post("/api/logout", (req, res) => {
  const token = parseCookieHeader(req.headers.cookie || "")[TOKEN_COOKIE];
  const logoutUserId = token && authDb.tokens[token] ? authDb.tokens[token].userId : null;

  if (logoutUserId) {
    Object.keys(authDb.tokens).forEach((tokenKey) => {
      if (authDb.tokens[tokenKey] && authDb.tokens[tokenKey].userId === logoutUserId) {
        delete authDb.tokens[tokenKey];
      }
    });

    saveDb(authDb);

    io.sockets.sockets.forEach((socketItem) => {
      if (socketItem.authUserId === logoutUserId) {
        socketItem.emit("forceLogout", "Bu hesap başka sekmeden çıkış yaptı.");
      }
    });
  } else if (token && authDb.tokens[token]) {
    delete authDb.tokens[token];
    saveDb(authDb);
  }

  res.setHeader("Set-Cookie", `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.json({ ok: false, user: null });
    return;
  }

  const activeAdminBan = getActiveAdminBan(user, getRequestIp(req), getRequestDeviceId(req), getRequestNetworkScope(req));
  if (activeAdminBan) {
    res.status(403).json({ ok: false, user: null, banned: true, message: formatAdminBanMessage(activeAdminBan) });
    return;
  }

  res.json({
    ok: true,
    user: safePublicUser(user),
    rank: getUserRank(user.id)
  });
});


app.get("/api/score-settings", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  res.json({
    ok: true,
    settings: getScoreSettings()
  });
});

app.post("/api/score-settings", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  const settings = updateScoreSettings(req.body || {});
  res.json({
    ok: true,
    settings,
    message: "Puan ayarları kaydedildi."
  });
});

app.get("/api/friends", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);
  res.json({
    ok: true,
    ...getFriendsPayload(user)
  });
});

app.post("/api/friend-request", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const target = findUserByUsername(req.body.username);
  if (!target) {
    res.status(404).json({ ok: false, message: "Oyuncu bulunamadı." });
    return;
  }

  ensureUserSocialFields(target);

  if (target.id === user.id) {
    res.status(400).json({ ok: false, message: "Kendini arkadaş ekleyemezsin." });
    return;
  }

  if (user.blockedUsers.includes(target.id)) {
    res.status(400).json({ ok: false, message: "Engellediğin oyuncuya istek gönderemezsin." });
    return;
  }

  if (target.blockedUsers.includes(user.id)) {
    res.status(400).json({ ok: false, message: "Bu oyuncu seni engellemiş." });
    return;
  }

  if (user.friends.includes(target.id)) {
    res.status(400).json({ ok: false, message: "Bu oyuncu zaten arkadaşın." });
    return;
  }

  if (user.friendRequests.includes(target.id)) {
    res.status(400).json({ ok: false, message: "Bu oyuncudan sana zaten istek gelmiş. Kabul etmen yeterli." });
    return;
  }

  if (target.friendRequests.includes(user.id) || user.sentFriendRequests.includes(target.id)) {
    res.status(400).json({ ok: false, message: "Bu oyuncuya zaten arkadaşlık isteği gönderdin." });
    return;
  }

  target.friendRequests.push(user.id);
  if (!user.sentFriendRequests.includes(target.id)) {
    user.sentFriendRequests.push(target.id);
  }

  saveDb(authDb);
  res.json({ ok: true, message: "Arkadaşlık isteği gönderildi.", ...getFriendsPayload(user) });
});

app.post("/api/friend-accept", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const requesterId = String(req.body.userId || "");
  const requester = authDb.users.find((item) => item.id === requesterId);

  if (!requester || !user.friendRequests.includes(requesterId)) {
    res.status(404).json({ ok: false, message: "Arkadaşlık isteği bulunamadı." });
    return;
  }

  ensureUserSocialFields(requester);

  user.friendRequests = user.friendRequests.filter((id) => id !== requesterId);

  if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
  if (!requester.friends.includes(user.id)) requester.friends.push(user.id);

  requester.sentFriendRequests = requester.sentFriendRequests.filter((id) => id !== user.id);

  saveDb(authDb);
  res.json({ ok: true, message: "Arkadaş eklendi.", ...getFriendsPayload(user) });
});

app.post("/api/friend-reject", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const requesterId = String(req.body.userId || "");
  user.friendRequests = user.friendRequests.filter((id) => id !== requesterId);

  const requester = authDb.users.find((item) => item.id === requesterId);
  if (requester) {
    ensureUserSocialFields(requester);
    requester.sentFriendRequests = requester.sentFriendRequests.filter((id) => id !== user.id);
  }

  saveDb(authDb);
  res.json({ ok: true, message: "İstek silindi.", ...getFriendsPayload(user) });
});

app.post("/api/friend-remove", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const requestedId = String(req.body.userId || "").trim();
  const requestedUsername = String(req.body.username || "").trim();
  const friend = authDb.users.find((item) => item.id === requestedId)
    || (requestedUsername ? findUserByUsername(requestedUsername) : null);

  if (!friend || !user.friends.includes(friend.id)) {
    res.status(404).json({ ok: false, message: "Arkadaşlık bulunamadı." });
    return;
  }

  ensureUserSocialFields(friend);
  user.friends = user.friends.filter((id) => id !== friend.id);
  friend.friends = friend.friends.filter((id) => id !== user.id);

  saveDb(authDb);
  res.json({ ok: true, message: "Arkadaşlıktan çıkarıldı.", ...getFriendsPayload(user) });
});

app.post("/api/user-block", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const targetId = String(req.body.userId || "").trim();
  const targetUsername = String(req.body.username || "").trim();
  const target = authDb.users.find((item) => item.id === targetId)
    || (targetUsername ? findUserByUsername(targetUsername) : null);

  if (!target) {
    res.status(404).json({ ok: false, message: "Oyuncu bulunamadı." });
    return;
  }

  if (target.id === user.id) {
    res.status(400).json({ ok: false, message: "Kendini engelleyemezsin." });
    return;
  }

  if (target.isAdmin === true) {
    res.status(403).json({ ok: false, message: "SFD SKETCH yönetici hesabı engellenemez." });
    return;
  }

  ensureUserSocialFields(target);

  if (!user.blockedUsers.includes(target.id)) {
    user.blockedUsers.push(target.id);
  }

  user.friends = user.friends.filter((id) => id !== target.id);
  user.friendRequests = user.friendRequests.filter((id) => id !== target.id);
  user.sentFriendRequests = user.sentFriendRequests.filter((id) => id !== target.id);

  target.friends = target.friends.filter((id) => id !== user.id);
  target.friendRequests = target.friendRequests.filter((id) => id !== user.id);
  target.sentFriendRequests = target.sentFriendRequests.filter((id) => id !== user.id);

  saveDb(authDb);
  res.json({ ok: true, message: "Oyuncu engellendi.", ...getFriendsPayload(user) });
});

app.post("/api/user-unblock", (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "Giriş yapmalısın." });
    return;
  }

  ensureUserSocialFields(user);

  const targetId = String(req.body.userId || "");
  user.blockedUsers = user.blockedUsers.filter((id) => id !== targetId);

  saveDb(authDb);
  res.json({ ok: true, message: "Oyuncu engeli kaldırıldı.", ...getFriendsPayload(user) });
});


app.get("/api/leaderboard", (req, res) => {
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit || 10)));
  const user = getUserFromReq(req);

  res.json({
    ok: true,
    top10: getLeaderboard(10),
    players: getLeaderboard(limit),
    meRank: user ? getUserRank(user.id) : null,
    me: user ? safePublicUser(user) : null
  });
});

app.use(express.static("public", {
  setHeaders(res, filePath) {
    const fileName = path.basename(filePath);
    if (fileName === "index.html") {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

const MAX_PLAYERS_PER_ROOM = 20;
const MIN_PLAYERS_TO_START = 2;
const ROUND_TIME = 90;
const TOTAL_ROUNDS = 10;
const START_COUNTDOWN_SECONDS = 5;
const INTERMISSION_SECONDS = 5;
const MAX_REPORT_USES_PER_GAME = 5;
const SKIP_VOTE_DURATION_MS = 15000;
const MIN_ACTIVE_PLAYERS_FOR_VOTE = 3;
const ROOM_REJOIN_GRACE_MS = 60 * 1000;

const WORDS_DIR = path.join(__dirname, "words");

function loadWordPool(filename, fallbackWords = []) {
  try {
    const text = fs.readFileSync(path.join(WORDS_DIR, filename), "utf8");
    const seen = new Set();
    const words = [];

    text.split(/\r?\n/).forEach((line) => {
      const word = String(line || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const key = word.toLocaleLowerCase("tr-TR");
      if (!key || key.length < 2 || seen.has(key)) return;
      seen.add(key);
      words.push(word);
    });

    if (words.length) {
      console.log(`[SFD WORDS] ${filename}: ${words.length} kelime yüklendi.`);
      return Object.freeze(words);
    }
  } catch (error) {
    console.error(`[SFD WORDS] ${filename} yüklenemedi:`, error.message);
  }

  return Object.freeze([...fallbackWords]);
}

const MIXED_ALL_WORD_POOL = loadWordPool("classic_tr_words.txt", ["araba", "telefon", "uçak", "kalem", "kedi", "köpek", "ev", "güneş"]);
const MIXED_EASY_WORD_POOL = loadWordPool("mixed_easy.txt", MIXED_ALL_WORD_POOL);
const MIXED_MEDIUM_WORD_POOL = loadWordPool("mixed_medium.txt", MIXED_ALL_WORD_POOL);
const MIXED_HARD_WORD_POOL = loadWordPool("mixed_hard.txt", MIXED_ALL_WORD_POOL);
const FILMS_EASY_WORD_POOL = loadWordPool("films_easy.txt", ["Titanik", "Avatar", "Hababam Sınıfı"]);
const FILMS_MEDIUM_WORD_POOL = loadWordPool("films_medium.txt", FILMS_EASY_WORD_POOL);
const FILMS_HARD_WORD_POOL = loadWordPool("films_hard.txt", FILMS_MEDIUM_WORD_POOL);
const ANIMALS_EASY_WORD_POOL = loadWordPool("animals_easy.txt", ["kedi", "köpek", "aslan"]);
const ANIMALS_MEDIUM_WORD_POOL = loadWordPool("animals_medium.txt", ANIMALS_EASY_WORD_POOL);
const ANIMALS_HARD_WORD_POOL = loadWordPool("animals_hard.txt", ANIMALS_MEDIUM_WORD_POOL);

const ROOM_THEME_DEFINITIONS = Object.freeze({
  mixed_easy: {
    label: "Karışık Kolay", shortLabel: "Karışık Kolay",
    groupKey: "mixed", groupLabel: "Karışık", difficultyKey: "easy", difficultyLabel: "Kolay",
    words: MIXED_EASY_WORD_POOL
  },
  mixed_medium: {
    label: "Karışık Orta", shortLabel: "Karışık Orta",
    groupKey: "mixed", groupLabel: "Karışık", difficultyKey: "medium", difficultyLabel: "Orta",
    words: MIXED_MEDIUM_WORD_POOL
  },
  mixed_hard: {
    label: "Karışık Zor", shortLabel: "Karışık Zor",
    groupKey: "mixed", groupLabel: "Karışık", difficultyKey: "hard", difficultyLabel: "Zor",
    words: MIXED_HARD_WORD_POOL
  },
  films_easy: {
    label: "Filmler Kolay", shortLabel: "Filmler Kolay",
    groupKey: "films", groupLabel: "Filmler", difficultyKey: "easy", difficultyLabel: "Kolay",
    words: FILMS_EASY_WORD_POOL
  },
  films_medium: {
    label: "Filmler Orta", shortLabel: "Filmler Orta",
    groupKey: "films", groupLabel: "Filmler", difficultyKey: "medium", difficultyLabel: "Orta",
    words: FILMS_MEDIUM_WORD_POOL
  },
  films_hard: {
    label: "Filmler Zor", shortLabel: "Filmler Zor",
    groupKey: "films", groupLabel: "Filmler", difficultyKey: "hard", difficultyLabel: "Zor",
    words: FILMS_HARD_WORD_POOL
  },
  animals_easy: {
    label: "Hayvanlar Kolay", shortLabel: "Hayvanlar Kolay",
    groupKey: "animals", groupLabel: "Hayvanlar", difficultyKey: "easy", difficultyLabel: "Kolay",
    words: ANIMALS_EASY_WORD_POOL
  },
  animals_medium: {
    label: "Hayvanlar Orta", shortLabel: "Hayvanlar Orta",
    groupKey: "animals", groupLabel: "Hayvanlar", difficultyKey: "medium", difficultyLabel: "Orta",
    words: ANIMALS_MEDIUM_WORD_POOL
  },
  animals_hard: {
    label: "Hayvanlar Zor", shortLabel: "Hayvanlar Zor",
    groupKey: "animals", groupLabel: "Hayvanlar", difficultyKey: "hard", difficultyLabel: "Zor",
    words: ANIMALS_HARD_WORD_POOL
  }
});

function sanitizeCustomWords(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || "").split(/[\n,;]+/);

  const seen = new Set();
  const cleaned = [];

  list.forEach((item) => {
    const word = String(item || "").trim().replace(/\s+/g, " ").slice(0, 50);
    const key = normalizeForWordCheck(word);
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    cleaned.push(word);
  });

  return cleaned.slice(0, 300);
}

function createRoom(id, name, type, password = null, options = {}) {
  const theme = ROOM_THEME_DEFINITIONS[options.themeKey] || null;
  const customWords = sanitizeCustomWords(options.customWords || []);

  return {
    id,
    name,
    type,
    password,
    themeKey: options.themeKey || null,
    themeLabel: options.themeLabel || (theme ? theme.label : null),
    themeGroupKey: theme ? theme.groupKey : null,
    themeGroupLabel: theme ? theme.groupLabel : null,
    difficultyKey: theme ? theme.difficultyKey : null,
    difficultyLabel: theme ? theme.difficultyLabel : null,
    instanceNumber: Number(options.instanceNumber || 0),
    wordPool: customWords.length ? customWords : (theme ? [...theme.words] : [...MIXED_ALL_WORD_POOL]),
    customWordCount: customWords.length,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    players: [],
    drawingData: [],
    currentDrawerIndex: 0,
    roundPendingDrawerIds: [],
    awayReturnTailIds: [],
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    word: "",
    revealedIndexes: [],
    hintStarted: false,
    earHintActive: false,
    timeLeft: ROUND_TIME,
    timer: null,
    countdownTimer: null,
    countdownLeft: 0,
    intermissionTimer: null,
    intermissionLeft: 0,
    correctWord: "",
    gameRestartTimer: null,
    ownerUserId: null,
    status: "waiting",
    adminPaused: false,

    turnCorrectCount: 0,
    turnHintCount: 0,
    turnDrawerGrossPoints: 0,
    turnDrawerAppliedPoints: 0,
    turnDrawerId: null,
    turnGuesserAwards: {},
    turnTransitioning: false,
    turnStartedAt: 0,
    drawerHasDrawn: false,

    turnReporters: new Set(),
    skipVoteActive: false,
    skipVoteYes: new Set(),
    skipVoteNo: new Set(),
    skipVoteNeeded: 0,
    skipVoteInitiatorId: null,
    skipVoteEndsAt: 0,
    skipVoteFastTrack: false,
    skipVoteTimer: null,
    skipVoteConvictionsByUserId: {}
  };
}

const fixedRooms = {};
const GLOBAL_ROOM_INSTANCES_PER_THEME = 2;

function createGlobalRoomInstance(themeKey, instanceNumber) {
  const theme = ROOM_THEME_DEFINITIONS[themeKey];
  if (!theme) return null;
  const id = `global-${themeKey}-${instanceNumber}`;
  const room = createRoom(id, `${theme.shortLabel}-${instanceNumber}`, "global", null, {
    themeKey,
    themeLabel: theme.label,
    instanceNumber
  });
  fixedRooms[id] = room;
  return room;
}

Object.keys(ROOM_THEME_DEFINITIONS).forEach((themeKey) => {
  for (let instanceNumber = 1; instanceNumber <= GLOBAL_ROOM_INSTANCES_PER_THEME; instanceNumber++) {
    createGlobalRoomInstance(themeKey, instanceNumber);
  }
});

const privateRooms = {};
const pendingRoomReturns = new Map();

function allRooms() {
  return {
    ...fixedRooms,
    ...privateRooms
  };
}

function getRoom(roomId) {
  return allRooms()[roomId];
}

function clearPendingRoomReturn(userId) {
  const key = String(userId || "");
  const record = pendingRoomReturns.get(key);
  if (!record) return null;
  if (record.timer) clearTimeout(record.timer);
  pendingRoomReturns.delete(key);
  return record;
}

function hasPendingReturnForRoom(roomId) {
  const target = String(roomId || "");
  for (const record of pendingRoomReturns.values()) {
    if (record && record.roomId === target && Number(record.expiresAt || 0) > Date.now()) return true;
  }
  return false;
}

function countPendingReturnsForRoom(roomId, exceptUserId = "") {
  const target = String(roomId || "");
  const except = String(exceptUserId || "");
  let count = 0;
  for (const [userId, record] of pendingRoomReturns.entries()) {
    if (userId === except) continue;
    if (record && record.roomId === target && Number(record.expiresAt || 0) > Date.now()) count++;
  }
  return count;
}

function cleanupEmptyPrivateRoom(room) {
  if (!room || room.type !== "private" || room.players.length > 0 || hasPendingReturnForRoom(room.id)) return;
  stopTimer(room);
  stopCountdown(room);
  stopIntermission(room);
  delete privateRooms[room.id];
  emitRoomsList();
}

function rememberPlayerForRoomReturn(room, player) {
  if (!room || !player || !player.userId || player.isAdmin === true) return null;
  clearPendingRoomReturn(player.userId);

  const record = {
    roomId: room.id,
    expiresAt: Date.now() + ROOM_REJOIN_GRACE_MS,
    player: {
      userId: player.userId,
      name: player.name,
      score: Number(player.score || 0),
      guessed: false,
      away: false,
      waitingNextRound: Boolean(player.waitingNextRound),
      roundsCompletedInGame: Math.max(0, Number(player.roundsCompletedInGame || 0)),
      warningUsesInGame: Math.max(0, Number(player.warningUsesInGame || 0)),
      lastVoteStartedRound: Math.max(0, Number(player.lastVoteStartedRound || 0)),
      afkSkippedTurnsInGame: Math.max(0, Number(player.afkSkippedTurnsInGame || 0)),
      skipVoteConvictionsInGame: Math.max(0, Number(player.skipVoteConvictionsInGame || 0)),
      voteLockedUntilRoundComplete: player.voteLockedUntilRoundComplete === true
    },
    timer: null
  };

  record.timer = setTimeout(() => {
    const current = pendingRoomReturns.get(String(player.userId));
    if (current !== record) return;
    // Bir dakika içinde dönmeyen oyuncunun oda puanı artık korunmaz.
    current.player.score = 0;
    pendingRoomReturns.delete(String(player.userId));
    cleanupEmptyPrivateRoom(getRoom(record.roomId));
  }, ROOM_REJOIN_GRACE_MS);

  pendingRoomReturns.set(String(player.userId), record);
  return record;
}

function takePendingRoomReturn(userId, roomId) {
  const key = String(userId || "");
  const record = pendingRoomReturns.get(key);
  if (!record) return null;
  if (Number(record.expiresAt || 0) <= Date.now()) {
    clearPendingRoomReturn(key);
    return null;
  }
  if (record.roomId !== String(roomId || "")) return null;
  clearPendingRoomReturn(key);
  return record;
}

function discardPendingReturnForOtherRoom(userId, targetRoomId) {
  const key = String(userId || "");
  const record = pendingRoomReturns.get(key);
  if (!record || record.roomId === String(targetRoomId || "")) return;
  const oldRoom = getRoom(record.roomId);
  clearPendingRoomReturn(key);
  cleanupEmptyPrivateRoom(oldRoom);
}

function findAvailableGlobalRoom(requestedRoom) {
  if (!requestedRoom || requestedRoom.type !== "global") return requestedRoom;
  if (getRoomCapacityPlayerCount(requestedRoom) + countPendingReturnsForRoom(requestedRoom.id) < requestedRoom.maxPlayers) return requestedRoom;

  const sameThemeRooms = Object.values(fixedRooms)
    .filter((room) => room.themeKey === requestedRoom.themeKey)
    .sort((a, b) => a.instanceNumber - b.instanceNumber);

  const available = sameThemeRooms.find((room) => getRoomCapacityPlayerCount(room) + countPendingReturnsForRoom(room.id) < room.maxPlayers);
  if (available) return available;

  // Her zorluk/tema için yalnızca iki sabit global oda bulunur.
  // İkisi de doluysa yeni oda oluşturulmaz; giriş akışı "bütün odalar dolu" uyarısı verir.
  return requestedRoom;
}

function getRandomWord(room) {
  const pool = room && Array.isArray(room.wordPool) && room.wordPool.length
    ? room.wordPool
    : MIXED_ALL_WORD_POOL;

  if (!room) return pool[Math.floor(Math.random() * pool.length)];
  if (!Array.isArray(room.usedWordKeysInGame)) room.usedWordKeysInGame = [];

  const usedKeys = new Set(room.usedWordKeysInGame);
  let available = pool.filter((word) => !usedKeys.has(normalizeForWordCheck(word)));

  if (!available.length) {
    room.usedWordKeysInGame = [];
    available = pool;
  }

  const selected = available[Math.floor(Math.random() * available.length)];
  const selectedKey = normalizeForWordCheck(selected);
  if (selectedKey) room.usedWordKeysInGame.push(selectedKey);
  return selected;
}

function activateWaitingPlayersForNextRound(room) {
  if (!room || !Array.isArray(room.players)) return;
  room.players.forEach((player) => {
    if (player.waitingNextRound) {
      player.waitingNextRound = false;
      player.guessed = false;
    }
  });
}

function isPlayableRoomPlayer(player) {
  return Boolean(player) && player.isAdmin !== true;
}

function getRoomParticipantPlayers(room) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.filter((player) => isPlayableRoomPlayer(player));
}

function getVisibleRoomPlayers(room) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.filter((player) => !(player.isAdmin === true && player.adminHidden === true));
}

function emitPlayersUpdate(room) {
  if (!room) return;
  io.to(room.id).emit("playersUpdate", getVisibleRoomPlayers(room));
}

function getRoomCapacityPlayerCount(room) {
  return getRoomParticipantPlayers(room).length;
}

function getActiveRoundPlayers(room) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.filter((player) => isPlayableRoomPlayer(player) && !player.waitingNextRound && !player.away);
}

function hasMinimumActivePlayersToStart(room) {
  return getActiveRoundPlayers(room).length >= MIN_PLAYERS_TO_START;
}

function isPlayerVoteReady(player) {
  return Boolean(player) && player.voteLockedUntilRoundComplete !== true;
}

function getVoteReadyActivePlayers(room) {
  return getActiveRoundPlayers(room).filter((player) => isPlayerVoteReady(player));
}

function hasMinimumVotePopulation(room) {
  return getActiveRoundPlayers(room).length >= MIN_ACTIVE_PLAYERS_FOR_VOTE;
}

function initializeRoundPendingDrawers(room) {
  if (!room) return [];
  room.roundPendingDrawerIds = getActiveRoundPlayers(room).map((player) => player.id);
  // Yeni round başladığında önceki roundun AWAY dönüş kuyruğu temizlenir.
  room.awayReturnTailIds = [];
  return room.roundPendingDrawerIds;
}

function chooseRandomFirstDrawerForGame(room) {
  if (!room || !Array.isArray(room.players) || room.players.length === 0) return null;

  // Geri sayım sona erene kadar odaya katılmış, AWAY olmayan bütün oyuncular
  // ilk çizer kurasına dahil edilir. Sonraki çizimler normal dairesel sırayla devam eder.
  initializeRoundPendingDrawers(room);
  const eligiblePlayers = getActiveRoundPlayers(room);
  if (!eligiblePlayers.length) {
    room.currentDrawerIndex = 0;
    return null;
  }

  const selected = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
  const selectedIndex = room.players.findIndex((player) => player.id === selected.id);
  room.currentDrawerIndex = selectedIndex >= 0 ? selectedIndex : 0;
  return selected;
}

function pruneRoundPendingDrawers(room) {
  if (!room) return [];
  const activeIds = new Set(getActiveRoundPlayers(room).map((player) => player.id));
  const seen = new Set();
  const pending = Array.isArray(room.roundPendingDrawerIds) ? room.roundPendingDrawerIds : [];
  room.roundPendingDrawerIds = pending.filter((playerId) => {
    if (!activeIds.has(playerId) || seen.has(playerId)) return false;
    seen.add(playerId);
    return true;
  });

  const pendingIds = new Set(room.roundPendingDrawerIds);
  const tailSeen = new Set();
  const tail = Array.isArray(room.awayReturnTailIds) ? room.awayReturnTailIds : [];
  room.awayReturnTailIds = tail.filter((playerId) => {
    if (!activeIds.has(playerId) || !pendingIds.has(playerId) || tailSeen.has(playerId)) return false;
    tailSeen.add(playerId);
    return true;
  });

  return room.roundPendingDrawerIds;
}

function enqueueAwayReturnAtRoundTail(room, player) {
  if (!room || !player || player.away || player.waitingNextRound) return false;

  if (!Array.isArray(room.roundPendingDrawerIds)) room.roundPendingDrawerIds = [];
  if (!Array.isArray(room.awayReturnTailIds)) room.awayReturnTailIds = [];

  // Oyuncu kuyrukta daha önce bulunuyorsa eski konumunu kaldırıp en sona taşı.
  room.roundPendingDrawerIds = room.roundPendingDrawerIds.filter((playerId) => playerId !== player.id);
  room.roundPendingDrawerIds.push(player.id);

  room.awayReturnTailIds = room.awayReturnTailIds.filter((playerId) => playerId !== player.id);
  room.awayReturnTailIds.push(player.id);
  pruneRoundPendingDrawers(room);
  return true;
}

function getPendingRoundPlayers(room) {
  if (!room) return [];
  const pendingIds = new Set(pruneRoundPendingDrawers(room));
  return getActiveRoundPlayers(room).filter((player) => pendingIds.has(player.id));
}

function getRoundParticipantPlayers(room) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.filter((player) => isPlayableRoomPlayer(player) && !player.waitingNextRound);
}

function getCurrentDrawer(room) {
  if (!room || !room.players.length) return null;
  const pendingPlayers = getPendingRoundPlayers(room);
  const activePlayers = pendingPlayers.length ? pendingPlayers : getActiveRoundPlayers(room);
  if (!activePlayers.length) return null;
  const allowedIds = new Set(activePlayers.map((player) => player.id));

  let safety = 0;
  while (safety < room.players.length) {
    const index = ((room.currentDrawerIndex % room.players.length) + room.players.length) % room.players.length;
    const player = room.players[index];
    if (player && allowedIds.has(player.id)) {
      room.currentDrawerIndex = index;
      return player;
    }
    room.currentDrawerIndex = (index + 1) % room.players.length;
    safety++;
  }

  return activePlayers[0] || null;
}

function getMaskedWord(room) {
  if (!room || !room.word) return "";
  return room.word
    .split("")
    .map((letter, index) => {
      if (letter === " ") return " ";
      return room.revealedIndexes.includes(index) ? letter : "_";
    })
    .join("");
}

function getRoomList(roomCollection) {
  return Object.values(roomCollection)
    .sort((a, b) => {
      const themeOrder = Object.keys(ROOM_THEME_DEFINITIONS);
      const aTheme = themeOrder.indexOf(a.themeKey);
      const bTheme = themeOrder.indexOf(b.themeKey);
      if (aTheme !== bTheme) return aTheme - bTheme;
      return Number(a.instanceNumber || 0) - Number(b.instanceNumber || 0);
    })
    .map((room) => ({
      id: room.id,
      name: room.name,
      type: room.type,
      maxPlayers: room.maxPlayers,
      playerCount: getRoomCapacityPlayerCount(room),
      locked: room.type === "private",
      status: room.status,
      themeKey: room.themeKey,
      themeLabel: room.themeLabel,
      themeGroupKey: room.themeGroupKey,
      themeGroupLabel: room.themeGroupLabel,
      difficultyKey: room.difficultyKey,
      difficultyLabel: room.difficultyLabel,
      instanceNumber: room.instanceNumber,
      customWordCount: room.customWordCount || 0
    }));
}

function emitRoomsList() {
  io.emit("roomsList", {
    globalRooms: getRoomList(fixedRooms),
    privateRooms: getRoomList(privateRooms)
  });
}

function getHiddenLetterCount(room) {
  if (!room || !room.word) return 0;
  return room.word.split("").reduce((count, letter, index) => {
    if (letter !== " " && !room.revealedIndexes.includes(index)) return count + 1;
    return count;
  }, 0);
}

function getEligibleGuessers(room, drawerId) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.filter((player) => isPlayableRoomPlayer(player) && player.id !== drawerId && !player.away);
}

function canPlayerReportDrawer(room, player, drawer) {
  if (!room || !player || !drawer) return false;
  if (room.status !== "playing" || player.id === drawer.id || drawer.isAdmin === true) return false;
  if (player.away || player.waitingNextRound || !isPlayerVoteReady(player)) return false;
  if (!hasMinimumVotePopulation(room)) return false;
  const eligibleVoters = getSkipVoteVoters(room, drawer);
  if (eligibleVoters.length < 2 || !eligibleVoters.some((item) => item.id === player.id)) return false;
  if (Number(player.warningUsesInGame || 0) >= MAX_REPORT_USES_PER_GAME) return false;
  // Bir oyuncu aynı raund içinde yalnızca bir kez vote başlatabilir.
  if (Number(player.lastVoteStartedRound || 0) === Number(room.round || 0)) return false;
  return true;
}

function sendGameState(room) {
  if (!room) return;
  const drawer = getCurrentDrawer(room);
  const hiddenLetterCount = getHiddenLetterCount(room);
  const baseState = {
    roomId: room.id,
    roomName: room.name,
    status: room.status,
    minPlayersToStart: MIN_PLAYERS_TO_START,
    playerCount: getRoomCapacityPlayerCount(room),
    activePlayerCount: getActiveRoundPlayers(room).length,
    round: room.round,
    totalRounds: room.totalRounds,
    timeLeft: room.timeLeft,
    countdownLeft: room.countdownLeft || 0,
    intermissionLeft: room.intermissionLeft || 0,
    correctWord: room.status === "intermission" ? room.correctWord : "",
    hasHint: room.hintStarted === true,
    maskedWord: room.word ? getMaskedWord(room) : "",
    hiddenLetterCount,
    hintAvailable:
      room.status === "playing" &&
      Boolean(room.word) &&
      Math.max(0, Number(room.turnCorrectCount || 0)) <= 0 &&
      (room.hintStarted !== true ? hiddenLetterCount > 0 : hiddenLetterCount > 1),
    canFinishTurn:
      room.status === "playing" &&
      Boolean(drawer) &&
      Math.max(0, Number(room.turnCorrectCount || 0)) > 0,
    skipAvailable: room.status === "playing" && Math.max(0, Number(room.turnCorrectCount || 0)) <= 0,
    drawerId: drawer ? drawer.id : null,
    drawerName: drawer ? drawer.name : null,
    earHintActive: room.earHintActive === true,
    skipVoteActive: room.skipVoteActive === true,
    skipVoteYesCount: room.skipVoteYes instanceof Set ? room.skipVoteYes.size : 0,
    skipVoteNoCount: room.skipVoteNo instanceof Set ? room.skipVoteNo.size : 0,
    skipVoteNeeded: Number(room.skipVoteNeeded || 0),
    skipVoteEndsAt: Number(room.skipVoteEndsAt || 0),
    skipVoteFastTrack: room.skipVoteFastTrack === true,
    voteActivePlayerCount: getActiveRoundPlayers(room).length,
    voteMinimumActivePlayers: MIN_ACTIVE_PLAYERS_FOR_VOTE,
    adminPaused: room.adminPaused === true
  };

  room.players.forEach((player) => {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (!playerSocket) return;
    const reportEligible = canPlayerReportDrawer(room, player, drawer);
    const eligibleSkipVoters = getSkipVoteVoters(room, drawer);
    const isEligibleSkipVoter = eligibleSkipVoters.some((item) => item.id === player.id);
    const alreadyReported =
      (room.turnReporters instanceof Set && room.turnReporters.has(player.id)) ||
      Number(player.lastVoteStartedRound || 0) === Number(room.round || 0);
    const warningUsesLeft = Math.max(0, MAX_REPORT_USES_PER_GAME - Number(player.warningUsesInGame || 0));
    const hasVotedSkip =
      (room.skipVoteYes instanceof Set && room.skipVoteYes.has(player.id)) ||
      (room.skipVoteNo instanceof Set && room.skipVoteNo.has(player.id));

    playerSocket.emit("gameState", {
      ...baseState,
      warningButtonVisible:
        room.status === "playing" &&
        Boolean(drawer) &&
        drawer.isAdmin !== true &&
        player.id !== drawer.id &&
        player.isAdmin !== true &&
        !player.away &&
        !player.waitingNextRound,
      // Oylama yokken ünlem yeni oylama başlatır. Oylama varken aynı ünlem
      // diğer oyuncuların oylama penceresini kendi istekleriyle açmasını sağlar.
      warningButtonEnabled:
        room.skipVoteActive === true
          ? isEligibleSkipVoter
          : reportEligible && !alreadyReported,
      voteLockedUntilRoundComplete: player.voteLockedUntilRoundComplete === true,
      playerAway: player.away === true,
      isAdmin: player.isAdmin === true,
      adminHidden: player.isAdmin === true && player.adminHidden === true,
      adminWord: player.isAdmin === true ? String(room.word || room.correctWord || "") : "",
      warningAlreadyUsed: room.skipVoteActive === true ? hasVotedSkip : alreadyReported,
      warningUsesLeft,
      // Çizen oyuncuya oylama penceresi ve aktif oylama durumu gönderilmez.
      skipVoteActive: room.skipVoteActive === true && isEligibleSkipVoter,
      skipVoteCanVote:
        room.skipVoteActive === true &&
        isEligibleSkipVoter &&
        !hasVotedSkip,
      skipVoteHasVoted: hasVotedSkip,
      skipVoteIsInitiator: room.skipVoteInitiatorId === player.id,
      // Popup açılmayan diğer tahminciler için ayrı çağrı durumu.
      // İstemci bunu kırmızı-sarı yanıp sönen ünlem olarak gösterir.
      skipVoteShouldAlert:
        room.skipVoteActive === true &&
        player.id !== (drawer && drawer.id) &&
        room.skipVoteInitiatorId !== player.id &&
        isEligibleSkipVoter &&
        !hasVotedSkip
    });
  });

  if (drawer && room.status === "playing") {
    io.to(drawer.id).emit("secretWord", room.word);
  }
}

function clearRoomCanvas(room) {
  if (!room) return;
  room.drawingData = [];
  io.to(room.id).emit("clearCanvas");
}

function resetPlayerGuesses(room) {
  if (!room) return;
  room.players.forEach((player) => {
    player.guessed = false;
    player.nearMiss = null;
  });
}

function stopTimer(room) {
  if (room && room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function stopCountdown(room) {
  if (room && room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  if (room) room.countdownLeft = 0;
}

function stopIntermission(room) {
  if (room && room.intermissionTimer) {
    clearInterval(room.intermissionTimer);
    room.intermissionTimer = null;
  }
  if (room) room.intermissionLeft = 0;
}

function resetPlayersForNewGame(room) {
  if (!room) return;
  room.players.forEach((player) => {
    player.waitingNextRound = false;
    player.guessed = false;
    player.roundsCompletedInGame = 0;
    player.warningUsesInGame = 0;
    player.lastVoteStartedRound = 0;
    player.afkSkippedTurnsInGame = 0;
    player.skipVoteConvictionsInGame = 0;
    player.voteLockedUntilRoundComplete = false;
  });
  room.skipVoteConvictionsByUserId = {};
  room.usedWordKeysInGame = [];
  room.currentDrawerIndex = 0;
  initializeRoundPendingDrawers(room);
}

function maybeStartCountdown(room) {
  if (!room) return;
  if (["playing", "starting", "intermission", "gameover"].includes(room.status)) return;
  if (!hasMinimumActivePlayersToStart(room)) return;

  stopTimer(room);
  stopCountdown(room);
  stopIntermission(room);

  room.status = "starting";
  room.countdownLeft = START_COUNTDOWN_SECONDS;
  room.word = "";
  room.correctWord = "";
  room.revealedIndexes = [];
  room.hintStarted = false;
  room.earHintActive = false;
  room.timeLeft = ROUND_TIME;
  room.round = 1;
  resetPlayersForNewGame(room);
  clearRoomCanvas(room);
  sendGameState(room);
  emitRoomsList();

  room.countdownTimer = setInterval(() => {
    if (room.adminPaused === true) { sendGameState(room); return; }
    room.countdownLeft--;

    if (!hasMinimumActivePlayersToStart(room)) {
      stopCountdown(room);
      room.status = "waiting";
      sendGameState(room);
      emitRoomsList();
      return;
    }

    if (room.countdownLeft <= 0) {
      stopCountdown(room);
      chooseRandomFirstDrawerForGame(room);
      startNewTurn(room);
      return;
    }

    sendGameState(room);
  }, 1000);
}

function emitSound(room, soundName) {
  if (!room || !soundName) return;
  io.to(room.id).emit("playSound", soundName);
}

function emitSoundToSocket(socket, soundName) {
  if (!socket || !soundName) return;
  socket.emit("playSound", soundName);
}


function didAllGuessersGuess(room, drawerId) {
  const eligibleGuessers = getEligibleGuessers(room, drawerId);
  return eligibleGuessers.length > 0 && eligibleGuessers.every((player) => player.guessed === true);
}

function triggerTimerPanic(room) {
  if (!room) return;
  io.to(room.id).emit("timerPanic", { timeLeft: room.timeLeft });
}

function resetTurnScoring(room, drawer = null) {
  if (!room) return;
  room.turnCorrectCount = 0;
  room.turnHintCount = 0;
  room.turnDrawerGrossPoints = 0;
  room.turnDrawerAppliedPoints = 0;
  room.turnDrawerId = drawer ? drawer.id : null;
  room.turnGuesserAwards = {};
}

function getGuesserPointsByOrder(order) {
  const safeOrder = Math.max(1, Number(order || 1));
  return Math.max(5, 10 - (safeOrder - 1));
}

function calculateDrawerGrossPoints(correctCount) {
  const safeCorrectCount = Math.max(0, Number(correctCount || 0));
  if (safeCorrectCount <= 0) return 0;
  return 10 + Math.min(5, Math.max(0, safeCorrectCount - 1));
}

function refreshDrawerTurnScore(room, drawer) {
  if (!room || !drawer) return { gross: 0, penalty: 0, net: 0, delta: 0 };
  if (room.turnDrawerId !== drawer.id) resetTurnScoring(room, drawer);

  const gross = calculateDrawerGrossPoints(room.turnCorrectCount);
  const penalty = Math.max(0, Number(room.turnHintCount || 0)) * 2;
  const net = Math.max(0, gross - penalty);
  const previousApplied = Math.max(0, Number(room.turnDrawerAppliedPoints || 0));
  const delta = net - previousApplied;

  drawer.score = Number(drawer.score || 0) + delta;
  room.turnDrawerGrossPoints = gross;
  room.turnDrawerAppliedPoints = net;
  return { gross, penalty, net, delta };
}

function recordGuesserAward(room, player, points) {
  if (!room || !player) return;
  if (!room.turnGuesserAwards || typeof room.turnGuesserAwards !== "object") {
    room.turnGuesserAwards = {};
  }
  room.turnGuesserAwards[player.id] = Number(room.turnGuesserAwards[player.id] || 0) + Number(points || 0);
}

function rollbackTurnScores(room) {
  if (!room) return;
  const awards = room.turnGuesserAwards && typeof room.turnGuesserAwards === "object"
    ? room.turnGuesserAwards
    : {};

  Object.entries(awards).forEach(([playerId, points]) => {
    const player = room.players.find((item) => item.id === playerId);
    if (player) player.score = Number(player.score || 0) - Number(points || 0);
  });

  const drawer = room.players.find((item) => item.id === room.turnDrawerId);
  if (drawer) {
    drawer.score = Number(drawer.score || 0) - Math.max(0, Number(room.turnDrawerAppliedPoints || 0));
  }

  resetTurnScoring(room, drawer || null);
}

function clearSkipVoteTimer(room) {
  if (room && room.skipVoteTimer) {
    clearTimeout(room.skipVoteTimer);
    room.skipVoteTimer = null;
  }
}

function resetTurnReports(room, emit = true) {
  if (!room) return;
  clearSkipVoteTimer(room);
  room.turnReporters = new Set();
  room.skipVoteActive = false;
  room.skipVoteYes = new Set();
  room.skipVoteNo = new Set();
  room.skipVoteNeeded = 0;
  room.skipVoteInitiatorId = null;
  room.skipVoteEndsAt = 0;
  room.skipVoteFastTrack = false;
  if (emit) io.to(room.id).emit("drawerReportReset");
}

function applyFailedVoteInitiatorPenalty(room) {
  if (!room) return false;
  const initiatorId = String(room.skipVoteInitiatorId || "");
  if (!initiatorId) return false;

  // Sarı ünleme basmak ceza sebebi değildir. Ceza yalnızca oylamayı
  // başlatan oyuncu EVET/Turu Atlat oyu verdiyse ve oylama geçersiz kaldıysa uygulanır.
  if (!(room.skipVoteYes instanceof Set) || !room.skipVoteYes.has(initiatorId)) return false;

  const initiator = room.players.find((item) => item.id === initiatorId);
  if (!initiator) return false;

  initiator.score = Number(initiator.score || 0) - 5;
  const initiatorSocket = io.sockets.sockets.get(initiator.id);
  if (initiatorSocket) {
    initiatorSocket.emit(
      "systemMessage",
      "Başlattığın Turu Atlat oylaması geçersiz kaldı. Ceza: -5 puan."
    );
  }
  emitPlayersUpdate(room);
  return true;
}

function settleUnsuccessfulReports(room) {
  // Yalnızca sarı ünleme basıldığı için puan cezası uygulanmaz.
  // Geçersiz oylama cezası, oylama sonuçlanırken ayrı olarak ele alınır.
  return false;
}

function emitToSkipVoteVoters(room, eventName, payload, exceptPlayerId = null) {
  if (!room) return;
  const drawer = getCurrentDrawer(room);
  getSkipVoteVoters(room, drawer).forEach((player) => {
    if (exceptPlayerId && player.id === exceptPlayerId) return;
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) playerSocket.emit(eventName, payload);
  });
}

function getSkipVoteVoters(room, drawer) {
  return getVoteReadyActivePlayers(room).filter((player) => !drawer || player.id !== drawer.id);
}

function refreshSkipVoteEligibility(room) {
  if (!room || !room.skipVoteActive) return true;
  const drawer = getCurrentDrawer(room);
  const voters = getSkipVoteVoters(room, drawer);
  const voterIds = new Set(voters.map((player) => player.id));

  if (room.skipVoteYes instanceof Set) {
    room.skipVoteYes = new Set([...room.skipVoteYes].filter((id) => voterIds.has(id)));
  }
  if (room.skipVoteNo instanceof Set) {
    room.skipVoteNo = new Set([...room.skipVoteNo].filter((id) => voterIds.has(id)));
  }

  const initiatorStillEligible = voterIds.has(String(room.skipVoteInitiatorId || ""));
  if (!hasMinimumVotePopulation(room) || voters.length < 2 || !initiatorStillEligible) {
    clearSkipVoteTimer(room);
    io.to(room.id).emit("skipVoteFailed");
    io.to(room.id).emit("systemMessage", "Aktif ve oy kullanmaya uygun oyuncu sayısı yetersiz kaldığı için oylama iptal edildi.");
    resetTurnReports(room, true);
    sendGameState(room);
    return false;
  }

  room.skipVoteNeeded = room.skipVoteFastTrack === true ? 1 : Math.floor(voters.length / 2) + 1;
  emitToSkipVoteVoters(room, "skipVoteUpdated", {
    yesCount: room.skipVoteYes instanceof Set ? room.skipVoteYes.size : 0,
    noCount: room.skipVoteNo instanceof Set ? room.skipVoteNo.size : 0,
    needed: room.skipVoteNeeded
  });

  if (room.skipVoteYes instanceof Set && room.skipVoteYes.size >= room.skipVoteNeeded) {
    passSkipVote(room);
    return false;
  }

  return true;
}

function getDrawerVoteConvictions(room, drawer) {
  if (!room || !drawer) return 0;
  const key = String(drawer.userId || drawer.id || "");
  const map = room.skipVoteConvictionsByUserId && typeof room.skipVoteConvictionsByUserId === "object"
    ? room.skipVoteConvictionsByUserId
    : {};
  room.skipVoteConvictionsByUserId = map;
  return Math.max(0, Number(map[key] ?? drawer.skipVoteConvictionsInGame ?? 0));
}

function addDrawerVoteConviction(room, drawer) {
  if (!room || !drawer) return 0;
  const key = String(drawer.userId || drawer.id || "");
  if (!room.skipVoteConvictionsByUserId || typeof room.skipVoteConvictionsByUserId !== "object") {
    room.skipVoteConvictionsByUserId = {};
  }
  const nextCount = getDrawerVoteConvictions(room, drawer) + 1;
  room.skipVoteConvictionsByUserId[key] = nextCount;
  drawer.skipVoteConvictionsInGame = nextCount;
  return nextCount;
}

function startSkipVote(room, initiatorId) {
  if (!room || room.skipVoteActive || room.status !== "playing") return false;
  const drawer = getCurrentDrawer(room);
  if (!drawer) return false;
  const voters = getSkipVoteVoters(room, drawer);
  if (!hasMinimumVotePopulation(room) || voters.length < 2) return false;

  const initiator = voters.find((player) => player.id === initiatorId);
  if (!initiator) return false;

  const convictions = getDrawerVoteConvictions(room, drawer);
  const fastTrack = convictions >= 2;

  room.skipVoteActive = true;
  room.skipVoteYes = new Set();
  room.skipVoteNo = new Set();
  room.skipVoteNeeded = fastTrack ? 1 : Math.floor(voters.length / 2) + 1;
  room.skipVoteInitiatorId = String(initiatorId || "");
  room.skipVoteEndsAt = Date.now() + SKIP_VOTE_DURATION_MS;
  room.skipVoteFastTrack = fastTrack;

  const payload = {
    drawerName: drawer.name,
    needed: room.skipVoteNeeded,
    durationMs: SKIP_VOTE_DURATION_MS,
    endsAt: room.skipVoteEndsAt,
    fastTrack,
    previousPenalties: convictions
  };

  // Popup yalnızca oylamayı başlatan oyuncuda otomatik açılır.
  const initiatorSocket = io.sockets.sockets.get(initiator.id);
  if (initiatorSocket) initiatorSocket.emit("skipVoteStarted", payload);

  io.to(room.id).emit(
    "systemMessage",
    `${initiator.name}, ${drawer.name} için Turu Atlat oylamasını başlattı.`
  );

  // Diğer tahmincilerde popup açılmaz; ünlem yanıp söner. Kendileri tıklayınca açarlar.
  emitToSkipVoteVoters(room, "skipVoteInvitation", payload, initiator.id);
  sendGameState(room);

  room.skipVoteTimer = setTimeout(() => {
    room.skipVoteTimer = null;
    if (!room.skipVoteActive || room.status !== "playing") return;
    room.skipVoteActive = false;
    applyFailedVoteInitiatorPenalty(room);
    emitToSkipVoteVoters(room, "skipVoteFailed");
    resetTurnReports(room, true);
    sendGameState(room);
  }, SKIP_VOTE_DURATION_MS);

  return true;
}

function passSkipVote(room) {
  if (!room || !room.skipVoteActive || room.turnTransitioning) return;
  const drawer = getCurrentDrawer(room);
  if (!drawer) return;

  clearSkipVoteTimer(room);
  room.skipVoteActive = false;
  const convictionCount = addDrawerVoteConviction(room, drawer);
  rollbackTurnScores(room);
  drawer.score = Number(drawer.score || 0) - 10;
  emitPlayersUpdate(room);
  emitToSkipVoteVoters(room, "skipVotePassed", {
    drawerName: drawer.name,
    convictionCount
  });

  const nextRule = convictionCount >= 2
    ? " Bu oyuncunun sonraki Turu Atlat oylamasında 1 Evet oyu yeterli olacak."
    : "";
  io.to(room.id).emit(
    "systemMessage",
    `${drawer.name} Turu Atlat oylaması nedeniyle çizimi iptal edildi! Ceza: -10 puan.${nextRule}`
  );
  goNextDrawer(room, {
    immediate: true,
    reportsHandled: true,
    resetScores: false,
    countTurn: false,
    outgoingDrawerId: drawer.id,
    outgoingDrawerIndex: room.players.findIndex((player) => player.id === drawer.id)
  });
}

function markDrawerActivity(room) {
  if (!room) return;
  room.drawerHasDrawn = true;
}

function maybeAutoSkipAfkDrawer(room) {
  if (!room || room.status !== "playing" || room.turnTransitioning || room.drawerHasDrawn) return false;
  if (!room.turnStartedAt || Date.now() - room.turnStartedAt < 15000) return false;
  const drawer = getCurrentDrawer(room);
  if (!drawer) return false;

  drawer.afkSkippedTurnsInGame = Math.max(0, Number(drawer.afkSkippedTurnsInGame || 0)) + 1;
  const autoAway = drawer.afkSkippedTurnsInGame >= 2;
  if (autoAway) drawer.away = true;

  io.to(room.id).emit(
    "systemMessage",
    autoAway
      ? `${drawer.name} ikinci kez çizim yapmadığı için sırası geçildi ve AWAY durumuna alındı.`
      : `${drawer.name} ilk 15 saniyede çizim yapmadığı için sırası otomatik geçildi. (1/2)`
  );
  emitPlayersUpdate(room);
  emitSound(room, "skip");
  goNextDrawer(room, {
    immediate: true,
    countTurn: false,
    outgoingDrawerId: drawer.id,
    outgoingDrawerIndex: room.players.findIndex((player) => player.id === drawer.id)
  });
  return true;
}

function startNewTurn(room, reason = "") {
  if (!room) return;
  stopTimer(room);
  stopIntermission(room);
  room.turnTransitioning = false;

  const drawablePlayers = getActiveRoundPlayers(room);
  if (drawablePlayers.length < MIN_PLAYERS_TO_START) {
    stopCountdown(room);
    room.status = "waiting";
    room.word = "";
    room.correctWord = "";
    room.revealedIndexes = [];
    room.hintStarted = false;
    room.earHintActive = false;
    room.timeLeft = ROUND_TIME;
    resetTurnScoring(room, null);
    resetTurnReports(room, true);
    clearRoomCanvas(room);
    sendGameState(room);
    emitRoomsList();
    return;
  }

  const drawer = getCurrentDrawer(room);
  if (!drawer) {
    room.status = "waiting";
    sendGameState(room);
    return;
  }

  stopCountdown(room);
  room.status = "playing";
  room.word = getRandomWord(room);
  room.correctWord = "";
  room.revealedIndexes = [];
  room.hintStarted = false;
  room.earHintActive = false;
  room.timeLeft = ROUND_TIME;
  room.turnStartedAt = Date.now();
  room.drawerHasDrawn = false;
  resetPlayerGuesses(room);
  resetTurnReports(room, true);
  resetTurnScoring(room, drawer);
  clearRoomCanvas(room);
  emitSound(room, "newRound");
  emitPlayersUpdate(room);

  if (reason) io.to(room.id).emit("systemMessage", reason);
  if (drawer) io.to(room.id).emit("systemMessage", `Çizim sırası: ${drawer.name}`);

  sendGameState(room);
  emitRoomsList();

  room.timer = setInterval(() => {
    if (room.status !== "playing" || room.turnTransitioning) return;
    if (room.adminPaused === true) { sendGameState(room); return; }
    room.timeLeft--;

    if (maybeAutoSkipAfkDrawer(room)) return;

    if (room.timeLeft === 15) triggerTimerPanic(room);

    if (room.timeLeft <= 0) {
      emitSound(room, "roundEnd");
      goNextDrawer(room, { intermission: true });
      return;
    }

    sendGameState(room);
  }, 1000);
}

function getRoomWinner(room) {
  const eligiblePlayers = getRoomParticipantPlayers(room);
  if (!eligiblePlayers.length) {
    return { id: null, name: "Oyuncu Yok", score: 0 };
  }
  return [...eligiblePlayers].sort((a, b) => {
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "tr");
  })[0];
}

function showWinnerAndRestart(room) {
  if (!room) return;
  stopTimer(room);
  stopCountdown(room);
  stopIntermission(room);
  resetTurnReports(room, true);

  if (room.gameRestartTimer) clearTimeout(room.gameRestartTimer);

  const winner = getRoomWinner(room);
  awardGlobalTop3Players(room);
  room.status = "gameover";
  room.word = "";
  room.correctWord = "";
  room.revealedIndexes = [];
  room.hintStarted = false;
  room.earHintActive = false;
  room.timeLeft = 15;
  clearRoomCanvas(room);
  sendGameState(room);
  emitPlayersUpdate(room);
  io.to(room.id).emit("gameFinished", {
    winner: {
      id: winner.id || null,
      userId: winner.userId || null,
      name: winner.name || "Oyuncu",
      score: Number(winner.score || 0)
    },
    durationMs: 15000
  });

  room.gameRestartTimer = setTimeout(() => {
    room.gameRestartTimer = null;
    resetRoomScores(room);
    room.round = 1;
    resetPlayersForNewGame(room);
    room.turnTransitioning = false;
    if (hasMinimumActivePlayersToStart(room)) startNewTurn(room);
    else {
      room.status = "waiting";
      sendGameState(room);
      emitRoomsList();
    }
  }, 15000);
}

function completeRoundForParticipants(room) {
  if (!room) return;
  getRoundParticipantPlayers(room).forEach((player) => {
    // AWAY durumundaki oyuncu roundu aktif tamamlamış sayılmaz.
    if (player.away) return;
    player.roundsCompletedInGame = Math.max(0, Number(player.roundsCompletedInGame || 0)) + 1;
    if (player.voteLockedUntilRoundComplete === true) {
      player.voteLockedUntilRoundComplete = false;
    }
  });
}

function findNextPendingDrawableIndex(room, startIndex) {
  if (!room || !room.players.length) return -1;
  const pendingIds = new Set(pruneRoundPendingDrawers(room));
  if (!pendingIds.size) return -1;

  const tailIds = Array.isArray(room.awayReturnTailIds) ? room.awayReturnTailIds : [];
  const tailSet = new Set(tailIds);
  const safeStart = Number.isInteger(startIndex) ? startIndex : -1;

  // Önce normal sıradaki oyuncular taranır. AWAY'den dönenler bilerek sona bırakılır.
  for (let offset = 1; offset <= room.players.length; offset++) {
    const index = ((safeStart + offset) % room.players.length + room.players.length) % room.players.length;
    const player = room.players[index];
    if (
      player &&
      isPlayableRoomPlayer(player) &&
      !player.waitingNextRound &&
      !player.away &&
      pendingIds.has(player.id) &&
      !tailSet.has(player.id)
    ) return index;
  }

  // Normal sıra bittikten sonra AWAY'i kapatan oyuncular dönüş sırasına göre çizime girer.
  for (const playerId of tailIds) {
    if (!pendingIds.has(playerId)) continue;
    const index = room.players.findIndex((player) => (
      player && isPlayableRoomPlayer(player) && player.id === playerId && !player.waitingNextRound && !player.away
    ));
    if (index >= 0) return index;
  }

  return -1;
}

function findFirstPendingDrawableIndex(room) {
  if (!room || !room.players.length) return -1;
  const pendingIds = new Set(pruneRoundPendingDrawers(room));
  const tailIds = Array.isArray(room.awayReturnTailIds) ? room.awayReturnTailIds : [];
  const tailSet = new Set(tailIds);

  const normalIndex = room.players.findIndex((player) => (
    player &&
    isPlayableRoomPlayer(player) &&
    !player.waitingNextRound &&
    !player.away &&
    pendingIds.has(player.id) &&
    !tailSet.has(player.id)
  ));
  if (normalIndex >= 0) return normalIndex;

  for (const playerId of tailIds) {
    if (!pendingIds.has(playerId)) continue;
    const index = room.players.findIndex((player) => (
      player && isPlayableRoomPlayer(player) && player.id === playerId && !player.waitingNextRound && !player.away
    ));
    if (index >= 0) return index;
  }

  return -1;
}

function findNextActiveDrawableIndex(room, startIndex, excludedPlayerId = "") {
  if (!room || !room.players.length) return -1;
  const safeStart = Number.isInteger(startIndex) ? startIndex : -1;

  for (let offset = 1; offset <= room.players.length; offset++) {
    const index = ((safeStart + offset) % room.players.length + room.players.length) % room.players.length;
    const player = room.players[index];
    if (
      player &&
      isPlayableRoomPlayer(player) &&
      !player.waitingNextRound &&
      !player.away &&
      player.id !== excludedPlayerId
    ) return index;
  }

  return -1;
}

function advanceDrawerQueue(room, options = {}) {
  if (!room || !room.players.length) return { gameEnded: false, hasDrawer: false };

  if (!Array.isArray(room.roundPendingDrawerIds) || !room.roundPendingDrawerIds.length) {
    initializeRoundPendingDrawers(room);
  }

  const outgoingDrawerId = String(options.outgoingDrawerId || "");
  const countTurn = options.countTurn !== false;
  if (countTurn && outgoingDrawerId) {
    room.roundPendingDrawerIds = room.roundPendingDrawerIds.filter((playerId) => playerId !== outgoingDrawerId);
    if (Array.isArray(room.awayReturnTailIds)) {
      room.awayReturnTailIds = room.awayReturnTailIds.filter((playerId) => playerId !== outgoingDrawerId);
    }
  }

  pruneRoundPendingDrawers(room);

  // SKIP tamamlanmış tur sayılmaz. Atlanan oyuncu round kuyruğunda kalır.
  // Kuyrukta yalnızca kendisi kaldıysa yine de doğrudan sıradaki aktif oyuncuya geçilir;
  // ardından atlanan oyuncu aynı round içinde yeniden sıraya gelir.
  if (
    !countTurn &&
    outgoingDrawerId &&
    room.roundPendingDrawerIds.length === 1 &&
    room.roundPendingDrawerIds[0] === outgoingDrawerId
  ) {
    const nextActiveIndex = findNextActiveDrawableIndex(
      room,
      Number(options.outgoingDrawerIndex ?? room.currentDrawerIndex),
      outgoingDrawerId
    );
    if (nextActiveIndex >= 0) {
      const nextActive = room.players[nextActiveIndex];
      if (nextActive && !room.roundPendingDrawerIds.includes(nextActive.id)) {
        room.roundPendingDrawerIds.push(nextActive.id);
      }
    }
  }

  if (room.roundPendingDrawerIds.length > 0) {
    const nextIndex = findNextPendingDrawableIndex(room, Number(options.outgoingDrawerIndex ?? room.currentDrawerIndex));
    if (nextIndex >= 0) {
      room.currentDrawerIndex = nextIndex;
      return { gameEnded: false, hasDrawer: true };
    }
  }

  completeRoundForParticipants(room);

  if (room.round >= room.totalRounds) {
    showWinnerAndRestart(room);
    return { gameEnded: true, hasDrawer: false };
  }

  room.round++;
  activateWaitingPlayersForNextRound(room);
  initializeRoundPendingDrawers(room);
  const firstIndex = findFirstPendingDrawableIndex(room);
  if (firstIndex < 0) {
    room.currentDrawerIndex = 0;
    return { gameEnded: false, hasDrawer: false };
  }

  room.currentDrawerIndex = firstIndex;
  return { gameEnded: false, hasDrawer: true };
}

function beginIntermission(room, word, transition = {}) {
  if (!room) return;
  room.status = "intermission";
  room.correctWord = String(word || "");
  room.intermissionLeft = INTERMISSION_SECONDS;
  room.timeLeft = 0;
  sendGameState(room);
  io.to(room.id).emit("intermissionStarted", {
    word: room.correctWord,
    seconds: INTERMISSION_SECONDS
  });

  room.intermissionTimer = setInterval(() => {
    if (room.adminPaused === true) { sendGameState(room); return; }
    room.intermissionLeft--;
    if (room.intermissionLeft <= 0) {
      stopIntermission(room);
      clearRoomCanvas(room);
      const advanced = advanceDrawerQueue(room, transition);
      if (advanced.gameEnded) return;
      if (!advanced.hasDrawer || !hasMinimumActivePlayersToStart(room)) {
        room.status = "waiting";
        room.turnTransitioning = false;
        sendGameState(room);
        emitRoomsList();
        return;
      }
      room.turnTransitioning = false;
      startNewTurn(room);
      return;
    }
    sendGameState(room);
  }, 1000);
}

function goNextDrawer(room, options = {}) {
  if (!room || room.turnTransitioning) return;
  room.turnTransitioning = true;
  const completedWord = room.word;
  const outgoingDrawer = getCurrentDrawer(room);
  const outgoingDrawerId = String(options.outgoingDrawerId || (outgoingDrawer && outgoingDrawer.id) || "");
  const outgoingDrawerIndex = Number.isInteger(options.outgoingDrawerIndex)
    ? options.outgoingDrawerIndex
    : (outgoingDrawer ? room.players.findIndex((player) => player.id === outgoingDrawer.id) : room.currentDrawerIndex);
  stopTimer(room);

  if (!options.reportsHandled) settleUnsuccessfulReports(room);
  resetTurnReports(room, true);
  room.earHintActive = false;

  if (!room.players.length) {
    room.status = "waiting";
    room.currentDrawerIndex = 0;
    room.turnTransitioning = false;
    return;
  }

  if (options.intermission) {
    beginIntermission(room, completedWord, {
      countTurn: options.countTurn !== false,
      outgoingDrawerId,
      outgoingDrawerIndex
    });
    return;
  }

  clearRoomCanvas(room);
  const advanced = advanceDrawerQueue(room, {
    countTurn: options.countTurn !== false,
    outgoingDrawerId,
    outgoingDrawerIndex
  });
  if (advanced.gameEnded) return;
  if (!advanced.hasDrawer || !hasMinimumActivePlayersToStart(room)) {
    room.status = "waiting";
    room.turnTransitioning = false;
    sendGameState(room);
    emitRoomsList();
    return;
  }

  emitSound(room, "roundNext");
  setTimeout(() => {
    room.turnTransitioning = false;
    startNewTurn(room);
  }, options.immediate ? 250 : 800);
}

function removePlayerFromRoom(room, socketId) {
  if (!room) return null;
  const drawerBeforeRemoval = room.status === "playing" ? getCurrentDrawer(room) : null;
  const wasDrawer = drawerBeforeRemoval && drawerBeforeRemoval.id === socketId;
  const removedIndex = room.players.findIndex((player) => player.id === socketId);
  if (removedIndex === -1) return null;

  if (wasDrawer) {
    rollbackTurnScores(room);
    settleUnsuccessfulReports(room);
    resetTurnReports(room, true);
    stopTimer(room);
  }

  const removedPlayer = room.players[removedIndex];
  room.players.splice(removedIndex, 1);

  if (removedPlayer && room.ownerUserId === removedPlayer.userId) {
    room.ownerUserId = room.players.length ? room.players[0].userId : null;
  }
  ensureRoomHost(room);

  if (wasDrawer) {
    room.currentDrawerIndex = removedIndex - 1;
    room.turnTransitioning = false;
    if (hasMinimumActivePlayersToStart(room)) {
      goNextDrawer(room, {
        immediate: true,
        reportsHandled: true,
        countTurn: false,
        outgoingDrawerId: removedPlayer ? removedPlayer.id : socketId,
        outgoingDrawerIndex: room.currentDrawerIndex
      });
    } else {
      room.status = "waiting";
      room.currentDrawerIndex = 0;
      clearRoomCanvas(room);
      sendGameState(room);
    }
  } else {
    if (removedIndex < room.currentDrawerIndex) room.currentDrawerIndex--;
    if (room.currentDrawerIndex >= room.players.length) room.currentDrawerIndex = 0;

    if (!hasMinimumActivePlayersToStart(room)) {
      stopCountdown(room);
      stopIntermission(room);
      startNewTurn(room);
    } else if (room.status === "waiting") {
      maybeStartCountdown(room);
    } else {
      sendGameState(room);
    }
  }

  if (!wasDrawer && room.skipVoteActive) refreshSkipVoteEligibility(room);
  return removedPlayer;
}

function ensureRoomHost(room) {
  if (!room || !Array.isArray(room.players)) return null;

  const eligibleHosts = room.players.filter((player) => player.isAdmin !== true);
  if (!eligibleHosts.length) {
    room.ownerUserId = null;
    room.players.forEach((player) => { player.isHost = false; });
    return null;
  }

  let host = eligibleHosts.find((player) => player.userId === room.ownerUserId);

  if (!host) {
    host = eligibleHosts[0];
    room.ownerUserId = host.userId;
  }

  room.players.forEach((player) => {
    player.isHost = player.isAdmin !== true && player.userId === room.ownerUserId;
  });

  return host;
}

function removeSocketFromRoom(socketItem) {
  if (!socketItem) return;

  const room = getRoom(socketItem.roomId);
  if (!room) return;

  socketItem.leave(room.id);
  socketItem.roomId = null;
  socketItem.playerName = null;
}


const PLAYER_REACTION_TYPES = Object.freeze({
  applause: "Alkış",
  laugh: "Kahkaha",
  slap: "Tokat",
  flirt: "Islık",
  kiss: "Öpücük"
});

const PLAYER_REACTION_COOLDOWN_MS = 1500;

io.on("connection", (socket) => {
  const connectedAuthUser = getUserFromSocket(socket);
  socket.authUserId = connectedAuthUser ? connectedAuthUser.id : null;
  socket.clientIp = getSocketIp(socket);
  socket.deviceId = getSocketDeviceId(socket);
  socket.networkScope = getSocketNetworkScope(socket);
  socket.isAdmin = connectedAuthUser && connectedAuthUser.isAdmin === true;
  if (connectedAuthUser) {
    let connectionIdentityChanged = false;
    if (isUsableClientIp(socket.clientIp)) {
      connectedAuthUser.lastKnownIp = normalizeClientIp(socket.clientIp);
      connectedAuthUser.lastKnownIpAt = new Date().toISOString();
      connectionIdentityChanged = true;
    }
    if (socket.deviceId) {
      connectedAuthUser.lastKnownDeviceId = socket.deviceId;
      connectedAuthUser.lastKnownDeviceAt = new Date().toISOString();
      connectionIdentityChanged = true;
    }
    if (connectionIdentityChanged) saveDb(authDb);
  }

  const connectionBan = connectedAuthUser ? getActiveAdminBan(connectedAuthUser, socket.clientIp, socket.deviceId, socket.networkScope) : null;
  if (connectionBan) {
    socket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(connectionBan) });
    setTimeout(() => socket.disconnect(true), 80);
    return;
  }

  console.log("Oyuncu bağlandı:", socket.id);

  socket.emit("roomsList", {
    globalRooms: getRoomList(fixedRooms),
    privateRooms: getRoomList(privateRooms)
  });

  socket.on("getRooms", () => {
    socket.emit("roomsList", {
      globalRooms: getRoomList(fixedRooms),
      privateRooms: getRoomList(privateRooms)
    });
  });

  socket.on("createPrivateRoom", ({ roomName, password, playerName, customWords, adminHidden }) => {
    const authUser = getUserFromSocket(socket);
    const cleanRoomName = String(roomName || "").trim().slice(0, 24);
    const cleanPassword = String(password || "").trim().slice(0, 24);
    const cleanPlayerName = authUser ? (authUser.isAdmin === true ? ADMIN_DISPLAY_NAME : authUser.username) : String(playerName || "").trim().slice(0, 18);

    if (!authUser) {
      socket.emit("joinError", "Özel oda kurmak için giriş yapmalısın.");
      return;
    }

    discardPendingReturnForOtherRoom(authUser.id, "__new_private_room__");

    const activePlayer = findActivePlayerByUserId(authUser.id);
    if (activePlayer && activePlayer.player.id !== socket.id) {
      socket.emit("joinError", "Bu hesap zaten başka bir odada açık. Önce diğer sekmeden Lobiye Dön veya sekmeyi kapat.");
      return;
    }

    if (!cleanRoomName || !cleanPassword || !cleanPlayerName) {
      socket.emit("joinError", "Oda adı, şifre ve oyuncu adı zorunlu.");
      return;
    }

    const roomId = "private-" + Math.floor(100000 + Math.random() * 900000);

    privateRooms[roomId] = createRoom(roomId, cleanRoomName, "private", cleanPassword, { customWords });
    privateRooms[roomId].ownerUserId = authUser.id;

    joinRoom(socket, roomId, cleanPlayerName, cleanPassword, adminHidden === true);
    emitRoomsList();
  });

  socket.on("joinRoom", ({ roomId, playerName, password, adminHidden }) => {
    joinRoom(socket, roomId, playerName, password, adminHidden === true);
  });

  socket.on("sendPlayerReaction", ({ targetSocketId, reaction } = {}) => {
    const room = getRoom(socket.roomId);
    const sender = room && room.players.find((player) => player.id === socket.id);
    const target = room && room.players.find((player) => player.id === String(targetSocketId || ""));
    const cleanReaction = String(reaction || "");

    if (!room || !sender || !target) {
      socket.emit("playerReactionRejected", "Oyuncu artık bu odada değil.");
      return;
    }

    if (sender.id === target.id) {
      socket.emit("playerReactionRejected", "Kendine etkileşim gönderemezsin.");
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(PLAYER_REACTION_TYPES, cleanReaction)) {
      socket.emit("playerReactionRejected", "Geçersiz etkileşim.");
      return;
    }

    const now = Date.now();
    const lastSentAt = Number(socket.lastPlayerReactionAt || 0);
    if (lastSentAt && now - lastSentAt < PLAYER_REACTION_COOLDOWN_MS) {
      socket.emit("playerReactionRejected", "Yeni bir etkileşim göndermek için kısa süre bekle.");
      return;
    }

    if (
      hasBlockedSender(target.userId, sender.userId) ||
      hasBlockedSender(sender.userId, target.userId)
    ) {
      socket.emit("playerReactionRejected", "Bu oyuncuyla etkileşim gönderimi kapalı.");
      return;
    }

    socket.lastPlayerReactionAt = now;

    io.to(room.id).emit("playerReaction", {
      reaction: cleanReaction,
      senderName: sender.name,
      senderId: sender.id,
      targetName: target.name,
      targetId: target.id
    });

    socket.emit("playerReactionSent", {
      reaction: cleanReaction,
      targetName: target.name,
      targetId: target.id
    });
  });


  function findActivePlayerByUserId(userId) {
    if (!userId) return null;

    const roomMap = typeof allRooms === "function"
      ? allRooms()
      : {
          ...(typeof fixedRooms !== "undefined" ? fixedRooms : {}),
          ...(typeof privateRooms !== "undefined" ? privateRooms : {})
        };

    for (const room of Object.values(roomMap)) {
      const player = room.players.find((item) => item.userId === userId);
      if (player) {
        return { room, player };
      }
    }

    return null;
  }

  function joinRoom(socket, roomId, playerName, password, requestedAdminHidden = false) {
    let room = getRoom(roomId);
    const authUser = getUserFromSocket(socket);
    const cleanPlayerName = authUser ? (authUser.isAdmin === true ? ADMIN_DISPLAY_NAME : authUser.username) : String(playerName || "").trim().slice(0, 18);
    const cleanPassword = String(password || "").trim().slice(0, 24);

    if (!room) {
      socket.emit("joinError", "Böyle bir oda yok.");
      return;
    }

    if (!authUser) {
      socket.emit("joinError", "Odaya girmek için giriş yapmalısın. Sayfayı yenileyip tekrar dene.");
      return;
    }

    // Socket bağlantısı girişten önce açılmış olabilir. Odaya girişte hesap ve IP
    // bilgisini yeniden eşitle; yönetim paneli kullanıcı adıyla IP banlarken
    // doğrudan bu aktif bağlantıyı güvenle bulabilsin.
    socket.authUserId = authUser.id;
    socket.isAdmin = authUser.isAdmin === true;
    const refreshedSocketIp = getSocketIp(socket);
    const refreshedDeviceId = getSocketDeviceId(socket) || normalizeDeviceId(socket.deviceId);
    const refreshedNetworkScope = getSocketNetworkScope(socket) || String(socket.networkScope || "");
    let joinIdentityChanged = false;
    if (isUsableClientIp(refreshedSocketIp)) {
      socket.clientIp = normalizeClientIp(refreshedSocketIp);
      authUser.lastKnownIp = socket.clientIp;
      authUser.lastKnownIpAt = new Date().toISOString();
      joinIdentityChanged = true;
    }
    if (refreshedNetworkScope) socket.networkScope = refreshedNetworkScope;
    if (refreshedDeviceId) {
      socket.deviceId = refreshedDeviceId;
      authUser.lastKnownDeviceId = refreshedDeviceId;
      authUser.lastKnownDeviceAt = new Date().toISOString();
      joinIdentityChanged = true;
    }
    if (joinIdentityChanged) saveDb(authDb);

    const activeAdminBan = getActiveAdminBan(authUser, socket.clientIp || refreshedSocketIp, socket.deviceId || refreshedDeviceId, socket.networkScope || getSocketNetworkScope(socket));
    if (activeAdminBan) {
      socket.emit("joinError", formatAdminBanMessage(activeAdminBan));
      return;
    }

    const roomBlock = getActiveAfkRoomBlock(authUser, room.id);
    if (roomBlock) {
      socket.emit(
        "joinError",
        `Bu odadan çizim yapmama cezasıyla atıldın. Tekrar girebilmek için ${formatPenaltyDuration(roomBlock.remainingMs)} beklemelisin.`
      );
      return;
    }

    discardPendingReturnForOtherRoom(authUser.id, room.id);
    const pendingReturn = pendingRoomReturns.get(String(authUser.id));
    const isReturningWithinGrace = Boolean(
      pendingReturn &&
      pendingReturn.roomId === room.id &&
      Number(pendingReturn.expiresAt || 0) > Date.now()
    );

    const activePlayer = findActivePlayerByUserId(authUser.id);
    if (activePlayer && activePlayer.player.id !== socket.id) {
      socket.emit("joinError", "Bu hesap zaten başka bir odada açık. Önce diğer sekmeden Lobiye Dön veya sekmeyi kapat.");
      return;
    }

    if (!cleanPlayerName) {
      socket.emit("joinError", "Oyuncu adı yazmalısın.");
      return;
    }

    if (room.type === "private" && room.password !== cleanPassword) {
      socket.emit("joinError", "Oda şifresi yanlış.");
      return;
    }

    const reservedReturnSlots = countPendingReturnsForRoom(room.id, authUser.id);
    if (authUser.isAdmin !== true && !isReturningWithinGrace && getRoomCapacityPlayerCount(room) + reservedReturnSlots >= room.maxPlayers) {
      if (room.type === "global") {
        const redirectedRoom = findAvailableGlobalRoom(room);
        if (redirectedRoom && redirectedRoom.id !== room.id) {
          room = redirectedRoom;
          socket.emit("roomAutoRedirected", {
            roomId: room.id,
            roomName: room.name,
            message: `Seçtiğin oda doluydu. Otomatik olarak ${room.name} odasına yönlendirildin.`
          });
        }
      }

      if (getRoomCapacityPlayerCount(room) + countPendingReturnsForRoom(room.id, authUser.id) >= room.maxPlayers) {
        socket.emit("joinError", "Bu temadaki bütün odalar dolu. Lütfen tekrar dene.");
        return;
      }
    }

    if (room.players.some((player) => player.id === socket.id)) {
      socket.emit("joinError", "Zaten bu odadasın.");
      return;
    }

    socket.join(room.id);

    const willBeHost = authUser.isAdmin !== true && !room.players.some((player) => player.isAdmin !== true);
    if (willBeHost) {
      room.ownerUserId = authUser.id;
    }

    const returnRecord = isReturningWithinGrace ? takePendingRoomReturn(authUser.id, room.id) : null;
    const savedPlayer = returnRecord && returnRecord.player ? returnRecord.player : null;
    const joinedDuringGame = room.status === "playing" || room.status === "intermission";

    room.players.push({
      id: socket.id,
      userId: authUser.id,
      name: cleanPlayerName,
      isAdmin: authUser.isAdmin === true,
      adminBadge: authUser.isAdmin === true ? "YÖNETİCİ" : "",
      adminHidden: authUser.isAdmin === true && requestedAdminHidden === true,
      score: savedPlayer ? Number(savedPlayer.score || 0) : 0,
      guessed: false,
      away: false,
      isHost: willBeHost,
      waitingNextRound: authUser.isAdmin === true ? true : joinedDuringGame,
      roundsCompletedInGame: savedPlayer ? Math.max(0, Number(savedPlayer.roundsCompletedInGame || 0)) : 0,
      warningUsesInGame: savedPlayer ? Math.max(0, Number(savedPlayer.warningUsesInGame || 0)) : 0,
      lastVoteStartedRound: savedPlayer ? Math.max(0, Number(savedPlayer.lastVoteStartedRound || 0)) : 0,
      afkSkippedTurnsInGame: savedPlayer ? Math.max(0, Number(savedPlayer.afkSkippedTurnsInGame || 0)) : 0,
      skipVoteConvictionsInGame: savedPlayer
        ? Math.max(0, Number(savedPlayer.skipVoteConvictionsInGame || 0))
        : Math.max(0, Number((room.skipVoteConvictionsByUserId || {})[authUser.id] || 0)),
      // Sonradan ilk kez katılan oyuncu bir tam round bitirene kadar vote kullanamaz.
      // Bir dakika içinde geri dönen oyuncunun önceki uygunluğu korunur.
      voteLockedUntilRoundComplete: savedPlayer
        ? savedPlayer.voteLockedUntilRoundComplete === true
        : joinedDuringGame
    });

    ensureRoomHost(room);

    socket.roomId = room.id;
    socket.playerName = cleanPlayerName;
    socket.adminHiddenPreference = authUser.isAdmin === true && requestedAdminHidden === true;

    socket.emit("joinedRoom", {
      roomId: room.id,
      roomName: room.name,
      roomType: room.type
    });

    socket.emit("loadDrawing", room.drawingData);

    ensureRoomHost(room);
    emitPlayersUpdate(room);
    if (!(authUser.isAdmin === true && requestedAdminHidden === true)) {
      emitToRoomRespectingBlocks(room, "roomPlayerJoined", { name: cleanPlayerName }, authUser.id);
    }

    const joinedPlayer = room.players.find((item) => item.id === socket.id);
    if (joinedPlayer && joinedPlayer.waitingNextRound) {
      // Sonradan giren oyuncu tahmin yapabilir, çizim sırasına yeni roundda dahil olur.
      // Users listesinde ekstra etiket veya oyun mesajı gösterilmez.
    }
    if (savedPlayer) {
      socket.emit("systemMessage", "1 dakika içinde geri döndüğün için oda puanın korundu.");
    }

    emitRoomsList();
    sendGameState(room);

    if (hasMinimumActivePlayersToStart(room) && room.status === "waiting") {
      maybeStartCountdown(room);
    } else if (!hasMinimumActivePlayersToStart(room)) {
      io.to(room.id).emit(
        "systemMessage",
        `Oyun için ${Math.max(0, MIN_PLAYERS_TO_START - getActiveRoundPlayers(room).length)} aktif oyuncu daha lazım.`
      );
    }
  }

  socket.on("drawerActivity", () => {
    const room = getRoom(socket.roomId);
    if (!room || room.status !== "playing" || room.adminPaused === true) return;
    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;
    markDrawerActivity(room);
  });

  socket.on("draw", (data) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const drawer = getCurrentDrawer(room);
    if (room.status !== "playing" || room.adminPaused === true || !drawer || drawer.id !== socket.id) return;

    markDrawerActivity(room);
    room.drawingData.push(data);
    socket.to(room.id).emit("draw", data);
  });


  socket.on("reportDrawer", () => {
    const room = getRoom(socket.roomId);
    if (!room || room.status !== "playing" || room.adminPaused === true || room.turnTransitioning) return;
    const drawer = getCurrentDrawer(room);
    const reporter = room.players.find((player) => player.id === socket.id);

    // Aktif oylamada ünleme basmak yalnızca istemcide popup açar; yeni rapor hakkı harcanmaz.
    if (room.skipVoteActive) return;

    if (!drawer || !reporter || !canPlayerReportDrawer(room, reporter, drawer)) {
      socket.emit(
        "drawerReportRejected",
        !hasMinimumVotePopulation(room)
          ? "Vote için odada AWAY olmayan en az 3 aktif oyuncu olmalı."
          : (reporter && reporter.voteLockedUntilRoundComplete === true
            ? "Vote kullanmadan önce aktif olarak 1 raund tamamlamalısın."
            : (reporter && Number(reporter.warningUsesInGame || 0) >= MAX_REPORT_USES_PER_GAME
              ? "Bu 10 raundluk oyunda 5 vote başlatma hakkını kullandın."
              : (reporter && Number(reporter.lastVoteStartedRound || 0) === Number(room.round || 0)
                ? "Bu raundda zaten vote başlattın. Tekrar kullanmak için sonraki raundu beklemelisin."
                : "Bu raundda sarı ünlem kullanma şartlarını karşılamıyorsun.")))
      );
      return;
    }

    if (!(room.turnReporters instanceof Set)) room.turnReporters = new Set();
    if (room.turnReporters.has(socket.id)) {
      socket.emit("drawerReportRejected", "Bu raundda zaten vote başlattın. Tekrar kullanmak için sonraki raundu beklemelisin.");
      return;
    }

    reporter.warningUsesInGame = Math.max(0, Number(reporter.warningUsesInGame || 0)) + 1;
    room.turnReporters.add(socket.id);

    const started = startSkipVote(room, reporter.id);
    if (!started) {
      room.turnReporters.delete(socket.id);
      reporter.warningUsesInGame = Math.max(0, Number(reporter.warningUsesInGame || 0) - 1);
      socket.emit("drawerReportRejected", "Oylama şu anda başlatılamadı.");
      return;
    }

    // Başarılı vote başlatma hakkı bu raund için kullanılmış sayılır.
    reporter.lastVoteStartedRound = Math.max(1, Number(room.round || 1));

    socket.emit("drawerReportAccepted", {
      usesLeft: Math.max(0, MAX_REPORT_USES_PER_GAME - reporter.warningUsesInGame)
    });
    emitSound(room, "whistle");
    emitPlayersUpdate(room);
    sendGameState(room);
  });

  // Eski istemci sürümleri için sarı ünlem olayı aynı sisteme yönlendirilir.
  socket.on("voteAfkSkip", () => {
    socket.emit("useNewReportEvent");
  });

  socket.on("voteSkipTurn", ({ vote } = {}) => {
    const room = getRoom(socket.roomId);
    if (!room || room.status !== "playing" || room.adminPaused === true || !room.skipVoteActive || room.turnTransitioning) return;
    const drawer = getCurrentDrawer(room);
    const voter = room.players.find((player) => player.id === socket.id);
    const eligibleVotersBeforeVote = getSkipVoteVoters(room, drawer);
    if (
      !drawer ||
      !voter ||
      voter.id === drawer.id ||
      voter.away ||
      voter.waitingNextRound ||
      voter.voteLockedUntilRoundComplete === true ||
      !eligibleVotersBeforeVote.some((player) => player.id === voter.id)
    ) return;

    if (!refreshSkipVoteEligibility(room) || !room.skipVoteActive) return;

    if (!(room.skipVoteYes instanceof Set)) room.skipVoteYes = new Set();
    if (!(room.skipVoteNo instanceof Set)) room.skipVoteNo = new Set();
    if (room.skipVoteYes.has(socket.id) || room.skipVoteNo.has(socket.id)) return;

    if (vote === true || vote === "yes") room.skipVoteYes.add(socket.id);
    else room.skipVoteNo.add(socket.id);

    const eligibleVoters = getSkipVoteVoters(room, drawer);
    room.skipVoteNeeded = room.skipVoteFastTrack === true ? 1 : Math.floor(eligibleVoters.length / 2) + 1;
    const yesCount = room.skipVoteYes.size;
    const noCount = room.skipVoteNo.size;

    emitToSkipVoteVoters(room, "skipVoteUpdated", {
      yesCount,
      noCount,
      needed: room.skipVoteNeeded
    });
    sendGameState(room);

    if (yesCount >= room.skipVoteNeeded) {
      passSkipVote(room);
      return;
    }

    // Yeterli Evet gelmezse oylama, herkes oy vermiş olsa bile 15 saniye sonunda kapanır.
  });

  socket.on("useEarHint", () => {
    const room = getRoom(socket.roomId);
    if (!room || room.status !== "playing") return;
    const drawer = getCurrentDrawer(room);
    if (!drawer || drawer.id !== socket.id || room.earHintActive) return;
    room.earHintActive = true;
    io.to(room.id).emit("earHintActivated", { drawerName: drawer.name });
    sendGameState(room);
  });

  socket.on("clearCanvas", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;

    const drawer = getCurrentDrawer(room);

    if (room.status !== "playing" || room.adminPaused === true) return;
    if (!drawer || drawer.id !== socket.id) return;

    clearRoomCanvas(room);
  });

  socket.on("skipTurn", () => {
    const room = getRoom(socket.roomId);
    if (!room || room.turnTransitioning) return;

    const drawer = getCurrentDrawer(room);
    if (room.status !== "playing" || room.adminPaused === true || !drawer || drawer.id !== socket.id) return;

    // İlk doğru tahminden sonra puanlar oluştuğu için SKIP kapanır; tur DONE ile bitirilir.
    if (Math.max(0, Number(room.turnCorrectCount || 0)) > 0) {
      sendGameState(room);
      return;
    }

    io.to(room.id).emit("systemMessage", `${drawer.name} çizimi atladı.`);
    emitSound(room, "skip");
    goNextDrawer(room, {
      immediate: true,
      countTurn: false,
      outgoingDrawerId: drawer.id,
      outgoingDrawerIndex: room.players.findIndex((player) => player.id === drawer.id)
    });
  });

  socket.on("finishTurn", () => {
    const room = getRoom(socket.roomId);
    if (!room || room.turnTransitioning) return;

    const drawer = getCurrentDrawer(room);
    if (room.status !== "playing" || room.adminPaused === true || !drawer || drawer.id !== socket.id) return;
    if (Math.max(0, Number(room.turnCorrectCount || 0)) <= 0) {
      sendGameState(room);
      return;
    }

    emitSound(room, "roundEnd");
    goNextDrawer(room, { intermission: true });
  });

  socket.on("requestHint", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const drawer = getCurrentDrawer(room);
    if (room.status !== "playing" || room.adminPaused === true || !drawer || drawer.id !== socket.id || !room.word) return;
    if (Math.max(0, Number(room.turnCorrectCount || 0)) > 0) {
      sendGameState(room);
      return;
    }

    const hiddenIndexes = [];
    room.word.split("").forEach((letter, index) => {
      if (letter !== " " && !room.revealedIndexes.includes(index)) hiddenIndexes.push(index);
    });

    // İlk HINT yalnızca kelimenin uzunluğunu/boş altıgenlerini gösterir.
    // Harf açma işlemi ikinci HINT'ten itibaren rastgele devam eder.
    if (room.hintStarted !== true) {
      if (hiddenIndexes.length <= 0) {
        sendGameState(room);
        return;
      }

      room.hintStarted = true;
      room.turnHintCount = Math.max(0, Number(room.turnHintCount || 0)) + 1;
      refreshDrawerTurnScore(room, drawer);
      emitSound(room, "hint");
      emitPlayersUpdate(room);
      sendGameState(room);
      return;
    }

    // Son gizli harf hiçbir zaman açılamaz. Bir harf kaldığında HINT kapanır.
    if (hiddenIndexes.length <= 1) {
      sendGameState(room);
      return;
    }

    const randomIndex = hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)];
    room.revealedIndexes.push(randomIndex);
    room.turnHintCount = Math.max(0, Number(room.turnHintCount || 0)) + 1;
    refreshDrawerTurnScore(room, drawer);
    emitSound(room, "hint");
    emitPlayersUpdate(room);
    sendGameState(room);
  });

  socket.on("chatMessage", (message) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const cleanMessage = String(message || "").trim().slice(0, 200);
    if (!cleanMessage) return;

    const player = room.players.find((item) => item.id === socket.id);
    const authUser = getUserFromSocket(socket);
    const isAdmin = Boolean(authUser && authUser.isAdmin === true);
    const drawer = getCurrentDrawer(room);
    if (!player) return;

    if (room.adminPaused === true && !isAdmin) return;
    if (room.status === "playing" && drawer && drawer.id === socket.id && !isAdmin) return;
    if (room.status === "playing" && player.away && !isAdmin) {
      socket.emit("awayGuessBlocked");
      return;
    }
    if (room.status === "playing" && player.guessed && !isAdmin) return;

    if (
      !isAdmin &&
      room.status === "playing" &&
      drawer &&
      drawer.id !== socket.id &&
      normalizeForWordCheck(cleanMessage) === normalizeForWordCheck(room.word)
    ) {
      // İlk 15 saniyede doğru tahmin gelmesi, çizen oyuncunun turda aktif
      // olduğunu kanıtlar. AFK otomatik geçişini iptal edip çizimi sürdür.
      markDrawerActivity(room);
      player.guessed = true;
      room.turnCorrectCount = Math.max(0, Number(room.turnCorrectCount || 0)) + 1;
      const guessOrder = room.turnCorrectCount;
      const points = getGuesserPointsByOrder(guessOrder);
      player.score = Number(player.score || 0) + points;
      recordGuesserAward(room, player, points);
      refreshDrawerTurnScore(room, drawer);

      if (guessOrder === 1) {
        room.timeLeft = 20;
        triggerTimerPanic(room);
      }

      emitToRoomRespectingBlocks(room, "systemMessage", `${player.name} kelimeyi doğru bildi! +${points} puan`, player.userId);
      emitSoundToSocket(socket, "winner");
      emitSoundToRoomRespectingBlocks(room, "otherCorrect", player.userId, socket.id);
      emitPlayersUpdate(room);
      sendGameState(room);

      if (didAllGuessersGuess(room, drawer.id)) {
        emitSound(room, "roundEnd");
        goNextDrawer(room, { intermission: true });
      }
      return;
    }

    if (
      room.status === "playing" &&
      drawer &&
      drawer.id !== socket.id &&
      shouldPlayNearMiss(player, cleanMessage, room.word)
    ) {
      socket.emit("nearGuess", { message: "Çok Yakın!" });
      emitSoundToSocket(socket, "nearMiss");
      return;
    }

    if (isAdmin) {
      io.to(room.id).emit("guessMessage", {
        name: ADMIN_DISPLAY_NAME,
        message: cleanMessage,
        isAdmin: true
      });
    } else {
      emitToRoomRespectingBlocks(room, "guessMessage", {
        name: socket.playerName,
        message: cleanMessage,
        isAdmin: false
      }, player.userId);
    }
  });


  const CHAT_EMOTICON_MAP = new Map([
    [":-))", "😂"], [":))", "😂"], [":'-)", "😂"], [":')", "😂"],
    ["X-D", "😂"], ["x-D", "😂"], ["XD", "😂"], ["xD", "😂"],
    [":-D", "😄"], [":D", "😄"], ["=D", "😄"],
    [":-)", "🙂"], [":)", "🙂"], ["=)", "🙂"], [":]", "🙂"], [":}", "🙂"], ["(:", "🙂"],
    [";-)", "😉"], [";)", "😉"], ["*)", "😉"], ["*-)", "😉"],
    [":-P", "😛"], [":P", "😛"], [":-p", "😛"], [":p", "😛"], ["=P", "😛"], ["=p", "😛"],
    [";P", "😜"], [";p", "😜"], ["xP", "😜"], ["XP", "😜"],
    [":'-(", "😭"], [":'(", "😭"], ["T_T", "😭"], ["T-T", "😭"], [";_;", "😭"], ["Q_Q", "😭"],
    [":-(", "🙁"], [":(", "🙁"], ["=(", "🙁"], [":[", "🙁"], ["):", "🙁"],
    [">:-(", "😠"], [">:(", "😠"], [":-@", "😡"], [":@", "😡"],
    [":-O", "😮"], [":O", "😮"], [":-o", "😮"], [":o", "😮"],
    ["O_O", "😳"], ["o_O", "😳"], ["O_o", "😳"], [":-$", "😳"], [":$", "😳"],
    [":-/", "😕"], [":/", "😕"], [":-\\", "😕"], [":\\", "😕"], ["=/", "😕"], ["=\\", "😕"],
    [":-|", "😐"], [":|", "😐"], ["-_-", "😑"], ["._.", "😑"],
    [":-*", "😘"], [":*", "😘"], [";*", "😘"],
    ["<3", "❤️"], ["♥", "❤️"], ["</3", "💔"], ["<\\3", "💔"],
    ["^_^", "😊"], ["^.^", "😊"], ["^^", "😊"],
    ["8-)", "😎"], ["8)", "😎"], ["B-)", "😎"], ["B)", "😎"],
    ["O:-)", "😇"], ["O:)", "😇"], ["0:-)", "😇"], ["0:)", "😇"],
    ["D-:", "😨"], ["D:", "😨"], [":-3", "😺"], [":3", "😺"],
    [":-S", "😖"], [":S", "😖"], [":s", "😖"],
    [":-X", "🤐"], [":X", "🤐"], [":x", "🤐"],
    [":-Z", "😴"], [":Z", "😴"], ["z_z", "😴"],
    ["o/", "👋"], ["\\o", "👋"],
    [":smile:", "🙂"], [":gül:", "🙂"], [":gul:", "🙂"],
    [":laugh:", "😂"], [":lol:", "😂"], [":kahkaha:", "😂"],
    [":wink:", "😉"], [":sad:", "🙁"], [":üzgün:", "🙁"], [":uzgun:", "🙁"],
    [":cry:", "😭"], [":ağla:", "😭"], [":agla:", "😭"],
    [":angry:", "😠"], [":kızgın:", "😠"], [":kizgin:", "😠"],
    [":heart:", "❤️"], [":love:", "❤️"], [":kalp:", "❤️"],
    [":cool:", "😎"], [":kiss:", "😘"], [":öpücük:", "😘"], [":opucuk:", "😘"],
    [":surprise:", "😮"], [":şaşkın:", "😮"], [":saskin:", "😮"],
    [":sleep:", "😴"], [":uyku:", "😴"]
  ]);

  const CHAT_EMOTICON_KEYS = [...CHAT_EMOTICON_MAP.keys()].sort((a, b) => b.length - a.length);

  function isChatWordCharacter(value) {
    return /[0-9A-Za-zÇĞİÖŞÜçğıöşü]/u.test(String(value || ""));
  }

  function replaceChatEmoticons(message) {
    const input = String(message || "");
    let output = "";
    let index = 0;

    while (index < input.length) {
      let matchedKey = null;

      for (const key of CHAT_EMOTICON_KEYS) {
        if (!input.startsWith(key, index)) continue;

        const nextChar = input[index + key.length] || "";
        if (nextChar && isChatWordCharacter(nextChar)) continue;

        // :/ ve :\\ URL/yol parçalarıyla karışabileceği için sol sınır da ister.
        if ([":/", ":-/", ":\\", ":-\\", "=/", "=\\"].includes(key)) {
          const previousChar = input[index - 1] || "";
          if (previousChar && isChatWordCharacter(previousChar)) continue;
        }

        matchedKey = key;
        break;
      }

      if (matchedKey) {
        output += CHAT_EMOTICON_MAP.get(matchedKey);
        index += matchedKey.length;
      } else {
        output += input[index];
        index += 1;
      }
    }

    return output;
  }

  function emitChatToPartition(room, sender, payload, guessedPartition) {
    room.players.forEach((receiver) => {
      if (Boolean(receiver.guessed) !== Boolean(guessedPartition)) return;
      if (hasBlockedSender(receiver.userId, sender.userId)) return;
      const receiverSocket = io.sockets.sockets.get(receiver.id);
      if (receiverSocket) receiverSocket.emit("chatMessage", payload);
    });
  }

  socket.on("normalChat", (message) => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    const cleanMessage = String(message || "").trim().slice(0, 200);
    if (!cleanMessage) return;

    const player = room.players.find((item) => item.id === socket.id);
    const authUser = getUserFromSocket(socket);
    const isAdmin = Boolean(authUser && authUser.isAdmin === true);
    const drawer = getCurrentDrawer(room);
    if (!player) return;
    if (room.status === "playing" && drawer && drawer.id === socket.id && !isAdmin) return;

    if (
      !isAdmin &&
      room.status === "playing" &&
      drawer &&
      drawer.id !== socket.id &&
      player.guessed !== true &&
      chatRevealsWord(cleanMessage, room.word)
    ) {
      return;
    }

    const payload = {
      name: socket.playerName,
      // Kısayollar yalnızca normal Chat mesajında emojiye çevrilir; tahmin alanına uygulanmaz.
      message: replaceChatEmoticons(cleanMessage),
      guessedOnly: room.status === "playing" && player.guessed === true,
      isAdmin
    };

    if (isAdmin) {
      payload.name = ADMIN_DISPLAY_NAME;
      payload.guessedOnly = false;
      io.to(room.id).emit("chatMessage", payload);
    } else if (room.status === "playing") {
      emitChatToPartition(room, player, payload, player.guessed === true);
    } else {
      emitToRoomRespectingBlocks(room, "chatMessage", payload, player.userId);
    }
  });

  socket.on("sendWhisper", ({ targetUsername, message } = {}) => {
    const senderUser = getUserFromSocket(socket);
    if (!senderUser) {
      socket.emit("whisperRejected", "Fısıltı göndermek için giriş yapmalısın.");
      return;
    }

    const now = Date.now();
    if (now - Number(socket.lastWhisperAt || 0) < 650) {
      socket.emit("whisperRejected", "Çok hızlı fısıltı gönderiyorsun. Biraz bekle.");
      return;
    }

    const cleanTargetUsername = String(targetUsername || "").trim().slice(0, 18);
    const cleanMessage = String(message || "").trim().slice(0, 200);
    if (!cleanTargetUsername || !cleanMessage) {
      socket.emit("whisperRejected", "Oyuncu adı ve mesaj zorunlu.");
      return;
    }

    const targetUser = findUserByUsername(cleanTargetUsername);
    if (!targetUser) {
      socket.emit("whisperRejected", `"${cleanTargetUsername}" adlı oyuncu bulunamadı.`);
      return;
    }

    if (targetUser.id === senderUser.id) {
      socket.emit("whisperRejected", "Kendine fısıltı gönderemezsin.");
      return;
    }

    ensureUserSocialFields(senderUser);
    ensureUserSocialFields(targetUser);
    if (senderUser.blockedUsers.includes(targetUser.id) || targetUser.blockedUsers.includes(senderUser.id)) {
      socket.emit("whisperRejected", "Bu oyuncuyla fısıltı gönderimi kullanılamıyor.");
      return;
    }

    const targetSockets = [];
    io.sockets.sockets.forEach((connectedSocket) => {
      if (connectedSocket.authUserId === targetUser.id) targetSockets.push(connectedSocket);
    });

    if (!targetSockets.length) {
      socket.emit("whisperRejected", `${targetUser.username} şu anda çevrimiçi değil.`);
      return;
    }

    socket.lastWhisperAt = now;
    const convertedMessage = replaceChatEmoticons(cleanMessage);
    const basePayload = {
      from: senderUser.isAdmin === true ? ADMIN_DISPLAY_NAME : senderUser.username,
      to: targetUser.isAdmin === true ? ADMIN_DISPLAY_NAME : targetUser.username,
      message: convertedMessage,
      sentAt: now
    };

    targetSockets.forEach((targetSocket) => {
      targetSocket.emit("whisperMessage", { ...basePayload, direction: "incoming" });
    });
    socket.emit("whisperMessage", { ...basePayload, direction: "outgoing" });
  });

  function requireAdminSocket() {
    const user = getUserFromSocket(socket);
    if (!user || user.isAdmin !== true) {
      socket.emit("adminActionResult", { ok: false, message: "Bu işlem yalnızca SFD SKETCH yöneticisine aittir." });
      return null;
    }
    return user;
  }

  function adminBroadcast(room, message) {
    if (!room) return;
    io.to(room.id).emit("adminAnnouncement", { name: ADMIN_DISPLAY_NAME, message: String(message || "") });
  }


  function buildAdminPanelData() {
    const room = getRoom(socket.roomId);
    const store = cleanupExpiredAdminBans();
    return {
      roomId: room ? room.id : null,
      roomName: room ? room.name : "",
      currentWord: room ? String(room.word || room.correctWord || "") : "",
      paused: room ? room.adminPaused === true : false,
      adminHidden: room ? Boolean((room.players.find((p) => p.id === socket.id) || {}).adminHidden) : Boolean(socket.adminHiddenPreference),
      userBans: Object.values(store.users),
      ipBans: [...Object.values(store.ips), ...Object.values(store.networks), ...Object.values(store.devices)]
    };
  }

  function emitAdminPanelData() {
    socket.emit("adminPanelData", buildAdminPanelData());
  }

  function removeBannedUserFromActiveSessions(targetUser, record) {
    const targetSockets = [];
    io.sockets.sockets.forEach((connectedSocket) => {
      if (connectedSocket.authUserId === targetUser.id) targetSockets.push(connectedSocket);
    });

    targetSockets.forEach((targetSocket) => {
      const targetRoom = getRoom(targetSocket.roomId);
      targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
      if (targetRoom) {
        removePlayerFromRoom(targetRoom, targetSocket.id);
        targetSocket.leave(targetRoom.id);
        targetSocket.roomId = null;
        targetSocket.playerName = null;
        emitPlayersUpdate(targetRoom);
        sendGameState(targetRoom);
      }
      setTimeout(() => targetSocket.disconnect(true), 150);
    });
    if (targetSockets.length) emitRoomsList();
  }

  function removeBannedIpFromActiveSessions(targetIp, record) {
    const normalizedIp = normalizeClientIp(targetIp);
    if (!isUsableClientIp(normalizedIp)) return;
    const targetSockets = [];
    const affectedRooms = new Set();

    io.sockets.sockets.forEach((connectedSocket) => {
      const connectedUser = authDb.users.find((user) => user.id === connectedSocket.authUserId);
      if (connectedUser && connectedUser.isAdmin === true) return;
      const connectedIp = normalizeClientIp(connectedSocket.clientIp || getSocketIp(connectedSocket));
      if (connectedIp === normalizedIp) targetSockets.push(connectedSocket);
    });

    targetSockets.forEach((targetSocket) => {
      const targetRoom = getRoom(targetSocket.roomId);
      targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
      if (targetRoom) {
        removePlayerFromRoom(targetRoom, targetSocket.id);
        targetSocket.leave(targetRoom.id);
        targetSocket.roomId = null;
        targetSocket.playerName = null;
        affectedRooms.add(targetRoom.id);
      }
      setTimeout(() => targetSocket.disconnect(true), 150);
    });

    affectedRooms.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      emitPlayersUpdate(room);
      sendGameState(room);
    });
    if (targetSockets.length) emitRoomsList();
  }


  function removeBannedDeviceFromActiveSessions(deviceId, record) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) return;
    const affectedRooms = new Set();
    let removedCount = 0;

    io.sockets.sockets.forEach((targetSocket) => {
      const connectedUser = authDb.users.find((user) => user.id === targetSocket.authUserId);
      if (connectedUser && connectedUser.isAdmin === true) return;
      if (normalizeDeviceId(targetSocket.deviceId) !== normalizedDeviceId) return;
      const targetRoom = getRoom(targetSocket.roomId);
      targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
      if (targetRoom) {
        removePlayerFromRoom(targetRoom, targetSocket.id);
        targetSocket.leave(targetRoom.id);
        targetSocket.roomId = null;
        targetSocket.playerName = null;
        affectedRooms.add(targetRoom.id);
      }
      removedCount += 1;
      setTimeout(() => targetSocket.disconnect(true), 150);
    });

    affectedRooms.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      emitPlayersUpdate(room);
      sendGameState(room);
    });
    if (removedCount) emitRoomsList();
  }


  function removeBannedNetworkScopeFromActiveSessions(networkScope, record) {
    const normalizedScope = String(networkScope || "").trim().toLowerCase();
    if (!normalizedScope) return;
    const affectedRooms = new Set();
    let removedCount = 0;

    io.sockets.sockets.forEach((targetSocket) => {
      const connectedUser = authDb.users.find((user) => user.id === targetSocket.authUserId);
      if (connectedUser && connectedUser.isAdmin === true) return;
      const socketScope = String(targetSocket.networkScope || getSocketNetworkScope(targetSocket) || "").trim().toLowerCase();
      if (socketScope !== normalizedScope) return;
      const targetRoom = getRoom(targetSocket.roomId);
      targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
      if (targetRoom) {
        removePlayerFromRoom(targetRoom, targetSocket.id);
        targetSocket.leave(targetRoom.id);
        targetSocket.roomId = null;
        targetSocket.playerName = null;
        affectedRooms.add(targetRoom.id);
      }
      removedCount += 1;
      setTimeout(() => targetSocket.disconnect(true), 150);
    });

    affectedRooms.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      emitPlayersUpdate(room);
      sendGameState(room);
    });
    if (removedCount) emitRoomsList();
  }

  socket.on("adminPauseToggle", () => {
    if (!requireAdminSocket()) return;
    const room = getRoom(socket.roomId);
    if (!room) return;
    room.adminPaused = room.adminPaused !== true;
    adminBroadcast(room, room.adminPaused ? "Oyunu durdurdu." : "Oyunu devam ettirdi.");
    sendGameState(room);
    socket.emit("adminActionResult", { ok: true, message: room.adminPaused ? "Oyun durduruldu." : "Oyun devam ediyor." });
  });

  socket.on("adminSkipTurn", () => {
    if (!requireAdminSocket()) return;
    const room = getRoom(socket.roomId);
    if (!room || room.status !== "playing" || room.turnTransitioning) return;
    const drawer = getCurrentDrawer(room);
    if (!drawer) return;
    adminBroadcast(room, `${drawer.name} oyuncusunun çizimini atlattı.`);
    goNextDrawer(room, { immediate: true, countTurn: false, outgoingDrawerId: drawer.id, outgoingDrawerIndex: room.players.findIndex((p) => p.id === drawer.id) });
  });

  socket.on("adminClearCanvas", () => {
    if (!requireAdminSocket()) return;
    const room = getRoom(socket.roomId);
    if (!room) return;
    clearRoomCanvas(room);
    adminBroadcast(room, "Çizim alanını temizledi.");
    socket.emit("adminActionResult", { ok: true, message: "Çizim alanı temizlendi." });
  });

  socket.on("adminKickPlayer", ({ targetSocketId, reason } = {}) => {
    if (!requireAdminSocket()) return;
    const room = getRoom(socket.roomId);
    const targetSocket = io.sockets.sockets.get(String(targetSocketId || ""));
    const target = room && room.players.find((p) => p.id === String(targetSocketId || ""));
    if (!room || !target || !targetSocket || target.isAdmin === true) return;
    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 120);
    adminBroadcast(room, `${target.name} odadan çıkarıldı. Sebep: ${cleanReason}`);
    targetSocket.emit("kickedFromRoom", `SFD SKETCH tarafından odadan çıkarıldın. Sebep: ${cleanReason}`);
    const removed = removePlayerFromRoom(room, target.id);
    targetSocket.leave(room.id);
    targetSocket.roomId = null;
    targetSocket.playerName = null;
    emitPlayersUpdate(room);
    sendGameState(room);
    emitRoomsList();
    addAdminAudit("kick", { targetUserId: removed && removed.userId, targetName: target.name, reason: cleanReason });
    saveDb(authDb);
  });

  socket.on("adminBanPlayer", ({ targetSocketId, durationMs, banIp, reason } = {}) => {
    if (!requireAdminSocket()) return;
    const room = getRoom(socket.roomId);
    const targetSocket = io.sockets.sockets.get(String(targetSocketId || ""));
    const target = room && room.players.find((p) => p.id === String(targetSocketId || ""));
    if (!room || !target || !targetSocket || target.isAdmin === true) return;
    const targetUser = authDb.users.find((u) => u.id === target.userId);
    if (!targetUser || targetUser.isAdmin === true) return;

    const duration = Math.max(0, Math.min(Number(durationMs || 0), 365 * 24 * 60 * 60 * 1000));
    const until = duration > 0 ? Date.now() + duration : 0;
    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 160);
    const targetBanIp = banIp === true ? normalizeClientIp(targetSocket.clientIp || getSocketIp(targetSocket)) : "";
    const targetNetworkScope = banIp === true ? String(targetSocket.networkScope || getSocketNetworkScope(targetSocket) || "").trim().toLowerCase() : "";
    if (banIp === true && !isUsableClientIp(targetBanIp) && !targetNetworkScope) {
      socket.emit("adminActionResult", {
        ok: false,
        action: "ip-ban",
        message: "Oyuncunun gerçek IP adresi alınamadı. Proxy ayarlarının X-Forwarded-For veya X-Real-IP başlığı gönderdiğini kontrol et."
      });
      return;
    }
    const store = ensureAdminBanStore();
    const record = {
      userId: targetUser.id,
      username: targetUser.username,
      displayName: target.name,
      until,
      permanent: until === 0,
      reason: cleanReason,
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_DISPLAY_NAME
    };
    store.users[targetUser.id] = record;
    if (banIp === true) {
      if (isUsableClientIp(targetBanIp)) {
        store.ips[targetBanIp] = { ...record, ip: targetBanIp, banKind: "ip", displayName: `${targetUser.username} • ${targetBanIp}` };
      } else if (targetNetworkScope) {
        store.networks[targetNetworkScope] = {
          ...record,
          networkScope: targetNetworkScope,
          banKind: "network",
          displayName: `${targetUser.username} • Yerel IP (tüm hesaplar)`
        };
      }
    }
    invalidateUserTokens(targetUser.id);
    addAdminAudit(banIp === true ? "ip-ban" : "user-ban", { targetUserId: targetUser.id, username: targetUser.username, until, reason: cleanReason });
    saveDb(authDb);

    if (banIp === true && isUsableClientIp(targetBanIp)) removeBannedIpFromActiveSessions(targetBanIp, record);
    if (banIp === true && targetNetworkScope) removeBannedNetworkScopeFromActiveSessions(targetNetworkScope, record);

    adminBroadcast(room, `${target.name} ${until ? "geçici" : "kalıcı"} olarak yasaklandı.${banIp === true ? " IP engeli uygulandı." : ""}`);
    targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
    const removed = removePlayerFromRoom(room, target.id);
    targetSocket.leave(room.id);
    targetSocket.roomId = null;
    targetSocket.playerName = null;
    emitPlayersUpdate(room);
    sendGameState(room);
    emitRoomsList();
    setTimeout(() => targetSocket.disconnect(true), 150);
  });

  socket.on("adminGetPanelData", () => {
    if (!requireAdminSocket()) return;
    emitAdminPanelData();
  });

  socket.on("adminBanByUsername", ({ username, durationMs, reason, banType } = {}) => {
    if (!requireAdminSocket()) return;

    const cleanUsername = String(username || "").trim().toLowerCase();
    const targetUser = authDb.users.find((user) =>
      String(user && user.username || "").trim().toLowerCase() === cleanUsername
    );

    if (!cleanUsername || !targetUser) {
      socket.emit("adminActionResult", {
        ok: false,
        action: banType === "ip" ? "ip-ban" : "username-ban",
        message: "Bu kullanıcı adına ait hesap bulunamadı."
      });
      return;
    }

    if (targetUser.isAdmin === true) {
      socket.emit("adminActionResult", {
        ok: false,
        action: banType === "ip" ? "ip-ban" : "username-ban",
        message: "Admin hesabı banlanamaz."
      });
      return;
    }

    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 160) || "Yönetici kararı";
    const duration = Math.max(0, Math.min(Number(durationMs || 0), 365 * 24 * 60 * 60 * 1000));
    const until = duration > 0 ? Date.now() + duration : 0;
    const store = ensureAdminBanStore();

    if (banType === "ip") {
      let targetIp = "";
      let targetNetworkScope = "";
      let targetDeviceId = "";
      const targetSockets = [];
      const seenSocketIds = new Set();

      const activePlayerRef = findActivePlayerByUserId(targetUser.id);
      if (activePlayerRef && activePlayerRef.player) {
        const roomSocket = io.sockets.sockets.get(activePlayerRef.player.id);
        if (roomSocket) {
          targetSockets.push(roomSocket);
          seenSocketIds.add(roomSocket.id);
          const candidateIp = normalizeClientIp(roomSocket.clientIp || getSocketIp(roomSocket));
          if (isUsableClientIp(candidateIp)) targetIp = candidateIp;
          const candidateScope = String(roomSocket.networkScope || getSocketNetworkScope(roomSocket) || "").trim().toLowerCase();
          if (candidateScope) targetNetworkScope = candidateScope;
          const candidateDevice = normalizeDeviceId(roomSocket.deviceId || getSocketDeviceId(roomSocket));
          if (candidateDevice) targetDeviceId = candidateDevice;
        }
      }

      io.sockets.sockets.forEach((connectedSocket) => {
        if (connectedSocket.authUserId !== targetUser.id || seenSocketIds.has(connectedSocket.id)) return;
        targetSockets.push(connectedSocket);
        seenSocketIds.add(connectedSocket.id);
        if (!targetIp) {
          const candidateIp = normalizeClientIp(connectedSocket.clientIp || getSocketIp(connectedSocket));
          if (isUsableClientIp(candidateIp)) targetIp = candidateIp;
        }
        if (!targetNetworkScope) {
          const candidateScope = String(connectedSocket.networkScope || getSocketNetworkScope(connectedSocket) || "").trim().toLowerCase();
          if (candidateScope) targetNetworkScope = candidateScope;
        }
        if (!targetDeviceId) {
          const candidateDevice = normalizeDeviceId(connectedSocket.deviceId || getSocketDeviceId(connectedSocket));
          if (candidateDevice) targetDeviceId = candidateDevice;
        }
      });

      if (!targetIp) {
        const storedIp = normalizeClientIp(targetUser.lastKnownIp || "");
        if (isUsableClientIp(storedIp)) targetIp = storedIp;
      }
      // localhost testinde tüm normal hesaplar aynı yerel IP kapsamındadır.
      // Hedef çevrimdışı olsa bile adminin aktif yerel bağlantısından kapsamı al.
      if (!targetIp && !targetNetworkScope) {
        const adminScope = String(socket.networkScope || getSocketNetworkScope(socket) || "").trim().toLowerCase();
        if (adminScope === "local-loopback") targetNetworkScope = adminScope;
      }
      if (!targetDeviceId) targetDeviceId = normalizeDeviceId(targetUser.lastKnownDeviceId || "");

      if (!targetIp && !targetNetworkScope && !targetDeviceId) {
        socket.emit("adminActionResult", {
          ok: false,
          action: "ip-ban",
          message: `${targetUser.username} hesabı için bağlantı kimliği bulunamadı. Oyuncu bu sürümle bir kez giriş yapmalı.`
        });
        return;
      }

      const usingNetworkFallback = !targetIp && Boolean(targetNetworkScope);
      const usingDeviceFallback = !targetIp && !usingNetworkFallback && Boolean(targetDeviceId);
      const record = {
        ip: targetIp || "",
        networkScope: targetNetworkScope || "",
        deviceId: targetDeviceId || "",
        banKind: usingNetworkFallback ? "network" : (usingDeviceFallback ? "device" : "ip"),
        username: targetUser.username,
        userId: targetUser.id,
        displayName: usingNetworkFallback
          ? `${targetUser.username} • Yerel IP (tüm hesaplar)`
          : (usingDeviceFallback ? `${targetUser.username} • Yerel cihaz` : `${targetUser.username} • ${targetIp}`),
        until,
        permanent: until === 0,
        reason: cleanReason,
        createdAt: new Date().toISOString(),
        createdBy: ADMIN_DISPLAY_NAME
      };

      if (usingNetworkFallback) {
        // Aynı kullanıcı için eski tarayıcı-cihaz fallback banlarını temizle;
        // yerel IP yasağı artık hesaptan bağımsız olarak tüm hesaplara uygulanır.
        Object.entries(store.devices).forEach(([deviceKey, deviceBan]) => {
          if (String(deviceBan && deviceBan.userId || "") === String(targetUser.id)) delete store.devices[deviceKey];
        });
        store.networks[targetNetworkScope] = record;
      } else if (usingDeviceFallback) store.devices[targetDeviceId] = record;
      else store.ips[targetIp] = record;
      invalidateUserTokens(targetUser.id);
      addAdminAudit(usingNetworkFallback ? "network-ban-by-username" : (usingDeviceFallback ? "device-ban-by-username" : "ip-ban-by-username"), {
        targetUserId: targetUser.id,
        username: targetUser.username,
        ip: targetIp,
        networkScope: targetNetworkScope,
        deviceId: targetDeviceId,
        until,
        reason: cleanReason
      });
      saveDb(authDb);

      if (usingNetworkFallback) removeBannedNetworkScopeFromActiveSessions(targetNetworkScope, record);
      else if (usingDeviceFallback) removeBannedDeviceFromActiveSessions(targetDeviceId, record);
      else removeBannedIpFromActiveSessions(targetIp, record);

      targetSockets.forEach((targetSocket) => {
        if (!targetSocket.connected) return;
        const sameIp = targetIp && normalizeClientIp(targetSocket.clientIp || getSocketIp(targetSocket)) === targetIp;
        const sameNetwork = targetNetworkScope && String(targetSocket.networkScope || getSocketNetworkScope(targetSocket) || "").trim().toLowerCase() === targetNetworkScope;
        const sameDevice = targetDeviceId && normalizeDeviceId(targetSocket.deviceId || getSocketDeviceId(targetSocket)) === targetDeviceId;
        if (sameIp || sameNetwork || sameDevice) return;
        const targetRoom = getRoom(targetSocket.roomId);
        targetSocket.emit("forceLogout", { reason: "ban", message: formatAdminBanMessage(record) });
        if (targetRoom) {
          removePlayerFromRoom(targetRoom, targetSocket.id);
          targetSocket.leave(targetRoom.id);
          targetSocket.roomId = null;
          targetSocket.playerName = null;
          emitPlayersUpdate(targetRoom);
          sendGameState(targetRoom);
        }
        setTimeout(() => targetSocket.disconnect(true), 150);
      });
      if (targetSockets.length) emitRoomsList();

      socket.emit("adminActionResult", {
        ok: true,
        action: "ip-ban",
        message: usingNetworkFallback
          ? `${targetUser.username} için yerel IP yasağı uygulandı. Bu bilgisayardaki tüm normal hesaplar engellendi.`
          : (usingDeviceFallback
            ? `${targetUser.username} için gerçek IP görünmediğinden yerel cihaz banı uygulandı.`
            : `${targetUser.username} kullanıcısının IP adresi kalıcı banlandı: ${targetIp}`)
      });
      emitAdminPanelData();
      return;
    }

    const record = {
      userId: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.username,
      until,
      permanent: until === 0,
      reason: cleanReason,
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_DISPLAY_NAME
    };

    store.users[targetUser.id] = record;
    invalidateUserTokens(targetUser.id);
    addAdminAudit("user-ban-by-username", {
      targetUserId: targetUser.id,
      username: targetUser.username,
      until,
      reason: cleanReason
    });
    saveDb(authDb);
    removeBannedUserFromActiveSessions(targetUser, record);

    socket.emit("adminActionResult", {
      ok: true,
      action: "username-ban",
      message: `${targetUser.username} hesabı ${until ? "süreli" : "kalıcı"} olarak banlandı.`
    });
    emitAdminPanelData();
  });

  socket.on("adminBanUsername", ({ username, durationMs, reason } = {}) => {
    if (!requireAdminSocket()) return;
    const cleanUsername = String(username || "").trim().toLowerCase();
    const targetUser = authDb.users.find((user) => String(user && user.username || "").trim().toLowerCase() === cleanUsername);
    if (!cleanUsername || !targetUser) {
      socket.emit("adminActionResult", { ok: false, action: "username-ban", message: "Bu kullanıcı adına ait hesap bulunamadı." });
      return;
    }
    if (targetUser.isAdmin === true) {
      socket.emit("adminActionResult", { ok: false, action: "username-ban", message: "Admin hesabı banlanamaz." });
      return;
    }

    const duration = Math.max(0, Math.min(Number(durationMs || 0), 365 * 24 * 60 * 60 * 1000));
    const until = duration > 0 ? Date.now() + duration : 0;
    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 160) || "Yönetici kararı";
    const record = {
      userId: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.username,
      until,
      permanent: until === 0,
      reason: cleanReason,
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_DISPLAY_NAME
    };

    const store = ensureAdminBanStore();
    store.users[targetUser.id] = record;
    invalidateUserTokens(targetUser.id);
    addAdminAudit("user-ban-by-username", { targetUserId: targetUser.id, username: targetUser.username, until, reason: cleanReason });
    saveDb(authDb);
    removeBannedUserFromActiveSessions(targetUser, record);

    socket.emit("adminActionResult", {
      ok: true,
      action: "username-ban",
      message: `${targetUser.username} hesabı ${until ? "süreli" : "kalıcı"} olarak banlandı.`
    });
    emitAdminPanelData();
  });

  function resolveLatestIpForUser(targetUser) {
    let activeIp = "";

    // Oda oyuncusu bağlantısı, sağ tık IP banının kullandığı en güvenilir kaynaktır.
    const activePlayerRef = findActivePlayerByUserId(targetUser.id);
    if (activePlayerRef && activePlayerRef.player) {
      const roomSocket = io.sockets.sockets.get(activePlayerRef.player.id);
      if (roomSocket) {
        const candidate = normalizeClientIp(roomSocket.clientIp || getSocketIp(roomSocket));
        if (isUsableClientIp(candidate)) activeIp = candidate;
      }
    }

    if (!activeIp) {
      io.sockets.sockets.forEach((connectedSocket) => {
        if (activeIp || connectedSocket.authUserId !== targetUser.id) return;
        const candidate = normalizeClientIp(connectedSocket.clientIp || getSocketIp(connectedSocket));
        if (isUsableClientIp(candidate)) activeIp = candidate;
      });
    }

    if (activeIp) return activeIp;
    const storedIp = normalizeClientIp(targetUser.lastKnownIp || "");
    return isUsableClientIp(storedIp) ? storedIp : "";
  }

  socket.on("adminBanUsernameIp", ({ username, durationMs, reason } = {}) => {
    if (!requireAdminSocket()) return;
    const cleanUsername = String(username || "").trim().toLowerCase();
    const targetUser = authDb.users.find((user) => String(user && user.username || "").trim().toLowerCase() === cleanUsername);
    if (!cleanUsername || !targetUser) {
      socket.emit("adminActionResult", { ok: false, action: "ip-ban", message: "Bu kullanıcı adına ait hesap bulunamadı." });
      return;
    }
    if (targetUser.isAdmin === true) {
      socket.emit("adminActionResult", { ok: false, action: "ip-ban", message: "Admin hesabının IP adresi banlanamaz." });
      return;
    }

    const normalizedIp = resolveLatestIpForUser(targetUser);
    if (!normalizedIp) {
      socket.emit("adminActionResult", {
        ok: false,
        action: "ip-ban",
        message: `${targetUser.username} hesabı için bilinen IP bulunamadı. Oyuncu en az bir kez bu sürümle giriş yapmalı.`
      });
      return;
    }

    const duration = Math.max(0, Math.min(Number(durationMs || 0), 365 * 24 * 60 * 60 * 1000));
    const until = duration > 0 ? Date.now() + duration : 0;
    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 160) || "Yönetici kararı";
    const record = {
      ip: normalizedIp,
      username: targetUser.username,
      userId: targetUser.id,
      displayName: `${targetUser.username} • ${normalizedIp}`,
      until,
      permanent: until === 0,
      reason: cleanReason,
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_DISPLAY_NAME
    };

    const store = ensureAdminBanStore();
    store.ips[normalizedIp] = record;
    addAdminAudit("ip-ban-by-username", { targetUserId: targetUser.id, username: targetUser.username, ip: normalizedIp, until, reason: cleanReason });
    saveDb(authDb);
    removeBannedIpFromActiveSessions(normalizedIp, record);

    socket.emit("adminActionResult", {
      ok: true,
      action: "ip-ban",
      message: `${targetUser.username} kullanıcısının IP adresi ${until ? "süreli" : "kalıcı"} olarak banlandı.`
    });
    emitAdminPanelData();
  });

  socket.on("adminBanIp", ({ ip, durationMs, reason } = {}) => {
    if (!requireAdminSocket()) return;
    const normalizedIp = normalizeClientIp(ip);
    if (!isUsableClientIp(normalizedIp)) {
      socket.emit("adminActionResult", { ok: false, action: "ip-ban", message: "Geçerli ve yerel olmayan bir IPv4 veya IPv6 adresi yazmalısın." });
      return;
    }

    const duration = Math.max(0, Math.min(Number(durationMs || 0), 365 * 24 * 60 * 60 * 1000));
    const until = duration > 0 ? Date.now() + duration : 0;
    const cleanReason = String(reason || "Yönetici kararı").trim().slice(0, 160) || "Yönetici kararı";
    const record = {
      ip: normalizedIp,
      displayName: normalizedIp,
      until,
      permanent: until === 0,
      reason: cleanReason,
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_DISPLAY_NAME
    };

    const store = ensureAdminBanStore();
    store.ips[normalizedIp] = record;
    addAdminAudit("ip-ban-by-address", { ip: normalizedIp, until, reason: cleanReason });
    saveDb(authDb);
    removeBannedIpFromActiveSessions(normalizedIp, record);

    socket.emit("adminActionResult", {
      ok: true,
      action: "ip-ban",
      message: `${normalizedIp} IP adresi ${until ? "süreli" : "kalıcı"} olarak banlandı.`
    });
    emitAdminPanelData();
  });

  socket.on("adminUnban", ({ userId, ip, deviceId, networkScope } = {}) => {
    if (!requireAdminSocket()) return;
    const store = ensureAdminBanStore();
    let changed = false;
    if (userId && store.users[String(userId)]) { delete store.users[String(userId)]; changed = true; }
    if (ip && store.ips[normalizeClientIp(ip)]) { delete store.ips[normalizeClientIp(ip)]; changed = true; }
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId && store.devices[normalizedDeviceId]) { delete store.devices[normalizedDeviceId]; changed = true; }
    const normalizedNetworkScope = String(networkScope || "").trim().toLowerCase();
    if (normalizedNetworkScope && store.networks[normalizedNetworkScope]) { delete store.networks[normalizedNetworkScope]; changed = true; }
    if (changed) { addAdminAudit("unban", { userId: String(userId || ""), ip: normalizeClientIp(ip || ""), deviceId: normalizedDeviceId, networkScope: normalizedNetworkScope }); saveDb(authDb); }
    socket.emit("adminActionResult", { ok: changed, action: "unban", message: changed ? "Yasak kaldırıldı." : "Aktif yasak bulunamadı." });
    emitAdminPanelData();
  });

  socket.on("adminSetHiddenMode", ({ hidden } = {}) => {
    if (!requireAdminSocket()) return;
    const nextHidden = hidden === true;
    socket.adminHiddenPreference = nextHidden;
    const room = getRoom(socket.roomId);
    if (room) {
      const adminPlayer = room.players.find((player) => player.id === socket.id && player.isAdmin === true);
      if (adminPlayer) adminPlayer.adminHidden = nextHidden;
      ensureRoomHost(room);
      emitPlayersUpdate(room);
      emitRoomsList();
      sendGameState(room);
    }
    socket.emit("adminHiddenModeChanged", { hidden: nextHidden });
    socket.emit("adminActionResult", {
      ok: true,
      message: nextHidden ? "Gizli yönetici modu açıldı." : "Yönetici artık odada görünür."
    });
  });

  socket.on("toggleAway", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;

    const player = room.players.find((item) => item.id === socket.id);
    if (!player) return;
    if (player.isAdmin === true) return;

    const drawer = getCurrentDrawer(room);
    if (room.status === "playing" && drawer && drawer.id === socket.id) {
      socket.emit("systemMessage", "Çizim sırası sendeyken AWAY açamazsın.");
      return;
    }

    const wasAway = player.away === true;
    player.away = !player.away;

    if (player.away) {
      // AWAY açan oyuncu mevcut çizim kuyruğundan tamamen çıkarılır.
      pruneRoundPendingDrawers(room);
    } else if (wasAway) {
      // AWAY'den çıkan oyuncu vote kullanmadan önce aktif olarak 1 round tamamlamalıdır.
      player.voteLockedUntilRoundComplete = true;

      if (
        ["playing", "intermission"].includes(room.status) &&
        !player.waitingNextRound
      ) {
        // Puanı korunur ve mevcut round çizim kuyruğunun en sonuna girer.
        enqueueAwayReturnAtRoundTail(room, player);
      }
    }

    if (room.skipVoteActive) refreshSkipVoteEligibility(room);
    emitPlayersUpdate(room);
const updatedDrawer = getCurrentDrawer(room);

    if (room.status === "playing" && updatedDrawer && updatedDrawer.id !== socket.id && player.id === socket.id && player.away) {
      // getCurrentDrawer already moved away from this player where possible.
    }

    if (room.status === "playing" && room.players[room.currentDrawerIndex] && room.players[room.currentDrawerIndex].id === socket.id && player.away) {
      goNextDrawer(room, { immediate: true });
      return;
    }

    if (room.status === "waiting" && hasMinimumActivePlayersToStart(room)) {
      maybeStartCountdown(room);
      return;
    }

    sendGameState(room);
  });


  socket.on("leaveRoom", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;

    const removedPlayer = removePlayerFromRoom(room, socket.id);
    if (removedPlayer) rememberPlayerForRoomReturn(room, removedPlayer);
    socket.leave(room.id);
    socket.roomId = null;
    socket.playerName = null;
    ensureRoomHost(room);
    emitPlayersUpdate(room);

    cleanupEmptyPrivateRoom(room);

    emitRoomsList();
    if (getRoom(room.id)) sendGameState(room);
  });

  socket.on("feedback", (data) => {
    const user = getUserFromSocket(socket);
    const text = String(data && data.text ? data.text : "").trim().slice(0, 1000);

    if (!text) return;

    const line = `[${new Date().toISOString()}] ${user ? user.username : "misafir"}: ${text.replace(/\r?\n/g, " ")}\n`;
    try {
      fs.appendFileSync(path.join(DATA_DIR, "feedback.log"), line, "utf8");
    } catch (error) {
      console.error("feedback yazılamadı:", error.message);
    }

    socket.emit("feedbackSaved", "Hata bildirimin kaydedildi.");
  });


  socket.on("disconnect", () => {
    const room = getRoom(socket.roomId);

    if (room) {
      const disconnectPlayer = room.players.find((item) => item.id === socket.id);
      const removedPlayer = removePlayerFromRoom(room, socket.id);
      if (removedPlayer) rememberPlayerForRoomReturn(room, removedPlayer);
      ensureRoomHost(room);

      emitPlayersUpdate(room);

      cleanupEmptyPrivateRoom(room);

      emitRoomsList();
    }

    console.log("Oyuncu ayrıldı:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("SFD Sketch çalışıyor: http://localhost:3000");
});