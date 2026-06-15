// SFD Sketch ilk HINT uzunluk, sonraki HINT rastgele harf - 2026-06-11
const SFD_DEVICE_STORAGE_KEY = "sfd_device_id";

function getOrCreateSfdDeviceId() {
  try {
    let value = String(localStorage.getItem(SFD_DEVICE_STORAGE_KEY) || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{16,96}$/.test(value)) {
      value = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
        ? globalThis.crypto.randomUUID().replaceAll("-", "")
        : `sfd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SFD_DEVICE_STORAGE_KEY, value);
    }
    return value;
  } catch (error) {
    return `sfd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }
}

const sfdDeviceId = getOrCreateSfdDeviceId();
const socket = io({ auth: { deviceId: sfdDeviceId } });

let forcedBanLocked = false;

function showPermanentBanScreen(message) {
  forcedBanLocked = true;

  try {
    socket.io.opts.reconnection = false;
    if (socket.connected) socket.disconnect();
  } catch (error) {}

  let overlay = document.getElementById("sfdBanLockOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "sfdBanLockOverlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="sfd-ban-lock-card">
        <div class="sfd-ban-lock-icon">⛔</div>
        <h2>Erişim Engellendi</h2>
        <p id="sfdBanLockMessage"></p>
        <div class="sfd-ban-lock-note">Yasak kaldırıldıktan sonra aşağıdaki düğmeyle tekrar kontrol edebilirsin.</div>
        <button id="sfdBanCheckBtn" type="button">Yasağı Tekrar Kontrol Et</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const checkBtn = document.getElementById("sfdBanCheckBtn");
    if (checkBtn) checkBtn.addEventListener("click", () => location.reload());
  }

  const messageNode = document.getElementById("sfdBanLockMessage");
  if (messageNode) messageNode.textContent = String(message || "Bu bağlantının oyuna erişimi yönetici tarafından engellendi.");
  document.body.classList.add("sfd-ban-locked");
}

function handleForcedLogout(payload) {
  const isStructured = payload && typeof payload === "object";
  const reason = isStructured ? String(payload.reason || "") : "";
  const message = isStructured ? String(payload.message || "") : String(payload || "");

  if (reason === "ban") {
    showPermanentBanScreen(message);
    return;
  }

  try {
    localStorage.setItem("sfd_logout_at", String(Date.now()));
  } catch (error) {}

  if (message) console.log(message);
  setTimeout(() => location.reload(), 150);
}

socket.on("forceLogout", (payload) => {
  handleForcedLogout(payload);
});

window.addEventListener("storage", (event) => {
  if (event.key === "sfd_logout_at" && !forcedBanLocked) {
    location.reload();
  }
});



const sounds = {
  winner: new Audio("/sounds/winner.wav"),
  otherCorrect: new Audio("/sounds/other_correct.wav"),
  skip: new Audio("/sounds/skip.wav"),
  roundEnd: new Audio("/sounds/round_end.wav"),
  newRound: new Audio("/sounds/new_round.wav"),
  roundNext: new Audio("/sounds/round_next.wav"),
  click: new Audio("/sounds/click.wav"),
  timerTick: new Audio("/sounds/timer_tick.wav"),
  hint: new Audio("/sounds/hint.wav"),
  nearMiss: new Audio("/sounds/near_miss.wav"),
  whistle: new Audio("/sounds/whistle.wav"),
  kick: new Audio("/sounds/kick.wav"),
  join: new Audio("/sounds/join.wav"),
  playerJoin: new Audio("/sounds/player_join.wav?v=chat-sound-v26-20260614"),
  yourTurn: new Audio("/sounds/your_turn.wav?v=chat-sound-v26-20260614"),
  whisper: new Audio("/sounds/whisper.mp3?v=whisper-last-v26-20260614"),
  reactionApplause: new Audio("/sounds/reaction_applause.mp3"),
  reactionLaugh: new Audio("/sounds/reaction_laugh.mp3"),
  reactionSlap: new Audio("/sounds/reaction_slap.mp3"),
  reactionFlirt: new Audio("/sounds/reaction_flirt.mp3"),
  reactionKiss: new Audio("/sounds/reaction_kiss.mp3"),
  winnerFireworks: new Audio("/sounds/winner_fireworks_15s.mp3"),
  winnerApplause: new Audio("/sounds/winner_applause_15s.mp3")
};

const isTouchAudioDevice =
  (navigator.maxTouchPoints || 0) > 0 ||
  window.matchMedia?.("(pointer: coarse)").matches === true;

let soundUnlocked = !isTouchAudioDevice;
let masterVolumeScale = 0.75;
const lastSoundTimes = {};

Object.values(sounds).forEach((sound) => {
  // Mobilde bütün sesleri sayfa açılır açılmaz indirmek ve oynatmak iPhone'u kilitliyordu.
  // Sesler artık sadece gerçekten gerektiğinde yüklenir.
  sound.preload = "none";
  sound.playsInline = true;
  sound.volume = 0.75;
});

function unlockSounds() {
  if (soundUnlocked) return;
  soundUnlocked = true;

  // iOS için yalnızca tek bir kısa ses öğesini sessizce hazırla.
  // Eski kod bütün sesleri aynı anda play() ile başlattığı için iPhone'da hepsi duyuluyordu.
  const primer = sounds.click;
  if (!primer) return;

  const oldMuted = primer.muted;
  const oldVolume = primer.volume;

  try {
    primer.preload = "metadata";
    primer.muted = true;
    primer.volume = 0;

    const restorePrimer = () => {
      try {
        primer.pause();
        primer.currentTime = 0;
      } catch (error) {}
      primer.muted = oldMuted;
      primer.volume = oldVolume;
      primer.preload = "none";
    };

    const playPromise = primer.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.then(restorePrimer).catch(restorePrimer);
    } else {
      restorePrimer();
    }
  } catch (error) {
    primer.muted = oldMuted;
    primer.volume = oldVolume;
    primer.preload = "none";
  }
}

// pointerdown, click'ten önce çalışır; böylece ilk dokunuşta ses sistemi hazırlanır.
document.addEventListener("pointerdown", unlockSounds, { once: true, passive: true });
document.addEventListener("touchstart", unlockSounds, { once: true, passive: true });
document.addEventListener("keydown", unlockSounds, { once: true });

function playGameSound(name, volume = 0.75, cooldown = 250) {
  const sound = sounds[name];
  if (!sound) return;

  // Kullanıcı henüz ekrana dokunmadıysa iOS'ta play() çağrılarını biriktirme.
  // Aksi halde ilk dokunuşta bekleyen sesler topluca başlayabiliyor.
  if (isTouchAudioDevice && !soundUnlocked) return;

  const now = Date.now();
  if (lastSoundTimes[name] && now - lastSoundTimes[name] < cooldown) return;
  lastSoundTimes[name] = now;

  try {
    sound.pause();
    sound.currentTime = 0;
    sound.preload = "auto";
    sound.volume = Math.max(0, Math.min(1, volume * masterVolumeScale));

    if (sound.networkState === HTMLMediaElement.NETWORK_EMPTY) {
      sound.load();
    }

    sound.play().catch(() => {});
  } catch (error) {}
}

let timerPanicActive = false;
let timerPanicInterval = null;
let lastKnownTimeLeft = 60;
let lastKnownRound = null;
let lastKnownDrawerId = null;

function startTimerPanicSound() {
  if (timerPanicInterval) return;

  playGameSound("timerTick", 0.58, 60);

  timerPanicInterval = setInterval(() => {
    playGameSound("timerTick", 0.58, 60);
  }, 260);
}

function stopTimerPanicSound() {
  if (timerPanicInterval) {
    clearInterval(timerPanicInterval);
    timerPanicInterval = null;
  }
}

function updateTimerPanicSound(state) {
  const shouldPanic =
    state &&
    state.status === "playing" &&
    (
      state.timeLeft <= 15 ||
      (timerPanicActive && state.timeLeft <= 20)
    );

  if (shouldPanic) {
    startTimerPanicSound();
  } else {
    stopTimerPanicSound();
  }
}

function playSoundFromServer(soundName) {
  if (soundName === "winner") playGameSound("winner", 0.9, 600);
  if (soundName === "otherCorrect") playGameSound("otherCorrect", 0.72, 600);
  if (soundName === "skip") playGameSound("skip", 0.78, 450);
  if (soundName === "roundEnd") playGameSound("roundEnd", 0.78, 650);
  if (soundName === "newRound") playGameSound("newRound", 0.72, 650);
  if (soundName === "roundNext") playGameSound("roundNext", 0.72, 650);
  if (soundName === "click") playGameSound("click", 0.45, 120);
  if (soundName === "timerTick") playGameSound("timerTick", 0.58, 60);
  if (soundName === "hint") playGameSound("hint", 0.72, 220);
  if (soundName === "nearMiss") playGameSound("nearMiss", 0.75, 900);
  if (soundName === "whistle") playGameSound("whistle", 0.88, 180);
  if (soundName === "kick") playGameSound("kick", 0.95, 900);
  if (soundName === "join") playGameSound("join", 0.74, 300);
  if (soundName === "playerJoin") playGameSound("playerJoin", 0.92, 500);
  if (soundName === "yourTurn") playGameSound("yourTurn", 0.96, 1000);
}

socket.on("playSound", (soundName) => {
  playSoundFromServer(soundName);
});

// Kabul edilen her AFK vote sesi odadaki tüm oyuncularda çalar.
socket.on("afkVoteSound", () => {
  playGameSound("whistle", 0.92, 0);
});

socket.on("timerPanic", () => {
  timerPanicActive = true;
  if (timerCircle) {
    timerCircle.classList.add("danger");
  }
  startTimerPanicSound();
});

const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const lobbyHomeLogo = document.querySelector("#lobbyScreen .lobby-home-logo");
const gameHomeLogo = document.querySelector("#gameScreen .game-home-logo");

function returnToMainPageFromLogo() {
  closeAllManagedModals();

  if (gameScreen && !gameScreen.classList.contains("hidden")) {
    socket.emit("leaveRoom");
    currentRoomId = null;
    if (typeof resetLocalAfkVote === "function") resetLocalAfkVote();
    gameScreen.classList.add("hidden");
  }

  if (lobbyScreen) lobbyScreen.classList.remove("hidden");
  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  setTimeout(() => socket.emit("getRooms"), 120);
}

[lobbyHomeLogo, gameHomeLogo].filter(Boolean).forEach((logo) => {
  logo.addEventListener("click", returnToMainPageFromLogo);
  logo.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      returnToMainPageFromLogo();
    }
  });
});

const menuBtn = document.getElementById("menuBtn");
const settingsBtn = document.getElementById("settingsBtn");
const gameMenuModal = document.getElementById("gameMenuModal");
const settingsModal = document.getElementById("settingsModal");
const menuBackLobbyBtn = document.getElementById("menuBackLobbyBtn");
const menuRulesBtn = document.getElementById("menuRulesBtn");
const menuRefreshBtn = document.getElementById("menuRefreshBtn");
const menuCloseBtn = document.getElementById("menuCloseBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsFriendsBtn = document.getElementById("settingsFriendsBtn");
const topFriendsBtn = document.getElementById("topFriendsBtn");
const topFriendsBadge = document.getElementById("topFriendsBadge");
const friendsModal = document.getElementById("friendsModal");
const friendsModalCloseBtn = document.getElementById("friendsModalCloseBtn");
const modalFriendUsernameInput = document.getElementById("modalFriendUsernameInput");
const modalSendFriendRequestBtn = document.getElementById("modalSendFriendRequestBtn");
const modalFriendMessage = document.getElementById("modalFriendMessage");
const modalFriendRequestsList = document.getElementById("modalFriendRequestsList");
const modalFriendsList = document.getElementById("modalFriendsList");
const modalBlockedList = document.getElementById("modalBlockedList");
const modalSentRequestsList = document.getElementById("modalSentRequestsList");
const modalOnlineList = document.getElementById("modalOnlineList");
const modalAllFriendsList = document.getElementById("modalAllFriendsList");
const discordPendingBadge = document.getElementById("discordPendingBadge");
const discordFriendsTitle = document.getElementById("discordFriendsTitle");
const discordFriendsSubtitle = document.getElementById("discordFriendsSubtitle");
const discordFriendTabs = document.querySelectorAll(".discord-friend-tab");
const discordTabPanels = document.querySelectorAll(".discord-tab-panel");
const playerContextMenu = document.getElementById("playerContextMenu");
const ctxWhisperBtn = document.getElementById("ctxWhisperBtn");
const ctxAddFriendBtn = document.getElementById("ctxAddFriendBtn");
const ctxBlockBtn = document.getElementById("ctxBlockBtn");
const adminContextSection = document.getElementById("adminContextSection");
const ctxAdminKickBtn = document.getElementById("ctxAdminKickBtn");
const ctxAdminSkipBtn = document.getElementById("ctxAdminSkipBtn");
const ctxAdminIpBanBtn = document.getElementById("ctxAdminIpBanBtn");
const ctxAdminBanButtons = document.querySelectorAll(".ctx-admin-ban-btn");
const adminToolbar = document.getElementById("adminToolbar");
const adminCurrentWord = document.getElementById("adminCurrentWord");
const adminPauseBtn = document.getElementById("adminPauseBtn");
const adminSkipBtn = document.getElementById("adminSkipBtn");
const adminClearBtn = document.getElementById("adminClearBtn");
const adminPanelBtn = document.getElementById("adminPanelBtn");
const adminPanelModal = document.getElementById("adminPanelModal");
const adminPanelCloseBtn = document.getElementById("adminPanelCloseBtn");
const adminPanelRoom = document.getElementById("adminPanelRoom");
const adminPanelWord = document.getElementById("adminPanelWord");
const adminPanelPauseState = document.getElementById("adminPanelPauseState");
const adminUserBans = document.getElementById("adminUserBans");
const adminIpBans = document.getElementById("adminIpBans");
const adminRoomStealthToggle = document.getElementById("adminRoomStealthToggle");
const ctxReactionButtons = document.querySelectorAll(".ctx-reaction-btn");
const soundSettingToggle = document.getElementById("soundSettingToggle");
const feedbackText = document.getElementById("feedbackText");
const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");
const openFeedbackModalBtn = document.getElementById("openFeedbackModalBtn");
const feedbackModal = document.getElementById("feedbackModal");
const feedbackCloseBtn = document.getElementById("feedbackCloseBtn");
const themeModal = document.getElementById("themeModal");
const themeCloseBtn = document.getElementById("themeCloseBtn");
const openThemeModalBtn = document.getElementById("openThemeModalBtn");
const soundVolumeSlider = document.getElementById("soundVolumeSlider");
const soundVolumeValue = document.getElementById("soundVolumeValue");
const soundSettingText = document.getElementById("soundSettingText");
const themeChoiceButtons = document.querySelectorAll(".theme-choice-btn");

const authPanel = document.getElementById("authPanel");
const roomPanel = document.getElementById("roomPanel");
const logoutBtn = document.getElementById("logoutBtn");
const rulesBtn = document.getElementById("rulesBtn");
const lobbySettingsBtn = document.getElementById("lobbySettingsBtn");
const lobbyFriendsBtn = document.getElementById("lobbyFriendsBtn");
const lobbyAdminBtn = document.getElementById("lobbyAdminBtn");
const adminLobbyModal = document.getElementById("adminLobbyModal");
const adminLobbyCloseBtn = document.getElementById("adminLobbyCloseBtn");
const adminLobbyStealthToggle = document.getElementById("adminLobbyStealthToggle");
const adminLobbyBanUsername = document.getElementById("adminLobbyBanUsername");
const adminLobbyBanDuration = document.getElementById("adminLobbyBanDuration");
const adminLobbyBanReason = document.getElementById("adminLobbyBanReason");
const adminLobbyBanBtn = document.getElementById("adminLobbyBanBtn");
const adminLobbyUserBans = document.getElementById("adminLobbyUserBans");
const adminLobbyIpBans = document.getElementById("adminLobbyIpBans");
const lobbyFriendsBadge = document.getElementById("lobbyFriendsBadge");
const rulesModal = document.getElementById("rulesModal");
const rulesCloseBtn = document.getElementById("rulesCloseBtn");
const rulesTabs = document.querySelectorAll(".rules-tab");
const rulesPanels = document.querySelectorAll(".rules-panel");
const friendUsernameInput = document.getElementById("friendUsernameInput");
const sendFriendRequestBtn = document.getElementById("sendFriendRequestBtn");
const friendMessage = document.getElementById("friendMessage");
const friendRequestsList = document.getElementById("friendRequestsList");
const friendsList = document.getElementById("friendsList");
const scoreCorrectMinInput = document.getElementById("scoreCorrectMin");
const scoreTimeMultiplierInput = document.getElementById("scoreTimeMultiplier");
const scoreDrawerBonusInput = document.getElementById("scoreDrawerBonus");
const scoreHintPenaltyInput = document.getElementById("scoreHintPenalty");
const scoreAwardRankGroupsInput = document.getElementById("scoreAwardRankGroups");
const saveScoreSettingsBtn = document.getElementById("saveScoreSettingsBtn");
const scoreSettingsMessage = document.getElementById("scoreSettingsMessage");
const showLoginBtn = document.getElementById("showLoginBtn");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const verifyForm = document.getElementById("verifyForm");
const authMessage = document.getElementById("authMessage");
const loginUserInput = document.getElementById("loginUser");
const loginPasswordInput = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotPasswordEmailInput = document.getElementById("forgotPasswordEmail");
const sendPasswordResetBtn = document.getElementById("sendPasswordResetBtn");
const backToLoginFromForgotBtn = document.getElementById("backToLoginFromForgotBtn");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const resetPasswordInput = document.getElementById("resetPasswordInput");
const resetPasswordAgainInput = document.getElementById("resetPasswordAgainInput");
const completePasswordResetBtn = document.getElementById("completePasswordResetBtn");
const backToLoginFromResetBtn = document.getElementById("backToLoginFromResetBtn");
const regFirstNameInput = document.getElementById("regFirstName");
const regLastNameInput = document.getElementById("regLastName");
const regUsernameInput = document.getElementById("regUsername");
const regBirthDayInput = document.getElementById("regBirthDay");
const regBirthMonthInput = document.getElementById("regBirthMonth");
const regBirthYearInput = document.getElementById("regBirthYear");
const regEmailInput = document.getElementById("regEmail");
const regPhoneInput = document.getElementById("regPhone");
const regPasswordInput = document.getElementById("regPassword");
const regPasswordAgainInput = document.getElementById("regPasswordAgain");
const registerBtn = document.getElementById("registerBtn");
const emailCodeInput = document.getElementById("emailCode");
const verifyBtn = document.getElementById("verifyBtn");
const resendCodeBtn = document.getElementById("resendCodeBtn");
const welcomeUser = document.getElementById("welcomeUser");
const welcomeRank = document.getElementById("welcomeRank");
const topList = document.getElementById("topList");
const topListLoggedIn = document.getElementById("topListLoggedIn");
const myRankBox = document.getElementById("myRankBox");
const myRankBoxLoggedIn = document.getElementById("myRankBoxLoggedIn");
const refreshLeaderboardBtn = document.getElementById("refreshLeaderboardBtn");
const showAllPlayersBtn = document.getElementById("showAllPlayersBtn");
const showAllPlayersBtnLoggedIn = document.getElementById("showAllPlayersBtnLoggedIn");
const allPlayersModal = document.getElementById("allPlayersModal");
const allPlayersList = document.getElementById("allPlayersList");
const closeAllPlayersBtn = document.getElementById("closeAllPlayersBtn");
let currentAuthUser = null;
let adminStealthPreference = false;

try {
  adminStealthPreference = localStorage.getItem("sfdSketchAdminStealth") === "1";
} catch (_) {
  adminStealthPreference = false;
}

function syncAdminStealthControls() {
  if (adminLobbyStealthToggle) adminLobbyStealthToggle.checked = adminStealthPreference;
  if (adminRoomStealthToggle) adminRoomStealthToggle.checked = adminStealthPreference;
}

function setAdminStealthPreference(hidden, persist = true) {
  adminStealthPreference = hidden === true;
  if (persist) {
    try { localStorage.setItem("sfdSketchAdminStealth", adminStealthPreference ? "1" : "0"); } catch (_) {}
  }
  syncAdminStealthControls();
}

function currentAdminStealthPreference() {
  return Boolean(currentAuthUser && currentAuthUser.isAdmin === true && adminStealthPreference);
}
let latestFriendsData = { friends: [], requests: [], sentRequests: [], blockedUsers: [], requestCount: 0 };
let activeFriendsTab = "add";

function updateDiscordFriendsHeader(tab) {
  if (!discordFriendsTitle || !discordFriendsSubtitle) return;
  const map = {
    add: ["Arkadaş Ekle", "Arkadaşlarını kullanıcı adı ile ekleyebilirsin."],
    friends: ["Arkadaşlar", "Ekli arkadaşlarının listesi."],
    online: ["Çevrimiçi", "Şu anda aktif olan arkadaşların."],
    all: ["Tümü", "Tüm arkadaşlarının tam listesi."],
    pending: ["Bekleyen", "Gelen ve gönderilen arkadaşlık istekleri."],
    blocked: ["Engellenenler", "Engellediğin oyuncular burada görünür."]
  };
  const pair = map[tab] || map.add;
  discordFriendsTitle.textContent = pair[0];
  discordFriendsSubtitle.textContent = pair[1];
}

function switchFriendsTab(tab) {
  activeFriendsTab = tab || "add";
  if (discordFriendTabs && discordFriendTabs.length) {
    discordFriendTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === activeFriendsTab));
  }
  if (discordTabPanels && discordTabPanels.length) {
    discordTabPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === activeFriendsTab));
  }
  updateDiscordFriendsHeader(activeFriendsTab);
}
let contextMenuTargetPlayer = null;
let whisperModeActive = false;
let whisperTargetUsername = "";
let lastWhisperTargetUsername = "";
let playerReactionCooldownUntil = 0;

const PLAYER_REACTIONS = {
  applause: { label: "Alkış", actionText: "alkışladı", sound: "reactionApplause", volume: 0.96 },
  laugh: { label: "Kahkaha", actionText: "kahkaha attı", sound: "reactionLaugh", volume: 0.95 },
  slap: { label: "Tokat", actionText: "tokat attı", sound: "reactionSlap", volume: 1.00 },
  flirt: { label: "Islık", actionText: "ıslık attı", sound: "reactionFlirt", volume: 0.92 },
  kiss: { label: "Öpücük", actionText: "öpücük attı", sound: "reactionKiss", volume: 0.92 }
};
let latestGameState = null;
let pendingVerifyUserId = null;
let pendingPasswordResetToken = "";
const globalRoomsList = document.getElementById("globalRoomsList");
const privateRoomsList = document.getElementById("privateRoomsList");
const privateRoomNameInput = document.getElementById("privateRoomName");
const privateRoomPasswordInput = document.getElementById("privateRoomPassword");
const privateRoomWordsInput = document.getElementById("privateRoomWords");
const createPrivateRoomBtn = document.getElementById("createPrivateRoomBtn");


function bindTopMenuEvents() {
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      openManagedModal(gameMenuModal);
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      openManagedModal(settingsModal);
    });
  }

  if (menuCloseBtn) {
    menuCloseBtn.addEventListener("click", () => {
      closeManagedModal(gameMenuModal);
    });
  }

  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener("click", () => {
      closeManagedModal(settingsModal);
    });
  }

  if (feedbackCloseBtn) {
    feedbackCloseBtn.addEventListener("click", () => {
      closeManagedModal(feedbackModal);
    });
  }

  if (themeCloseBtn) {
    themeCloseBtn.addEventListener("click", () => {
      closeManagedModal(themeModal);
    });
  }

  if (openThemeModalBtn) {
    openThemeModalBtn.addEventListener("click", () => {
      openManagedModal(themeModal);
    });
  }

  if (openFeedbackModalBtn) {
    openFeedbackModalBtn.addEventListener("click", () => {
      openManagedModal(feedbackModal);
    });
  }

  if (menuBackLobbyBtn) {
    menuBackLobbyBtn.addEventListener("click", () => {
      socket.emit("leaveRoom");
      closeManagedModal(gameMenuModal);
      gameScreen.classList.add("hidden");
      lobbyScreen.classList.remove("hidden");
      setTimeout(() => socket.emit("getRooms"), 150);
    });
  }

  if (menuRulesBtn) {
    menuRulesBtn.addEventListener("click", () => {
      closeManagedModal(gameMenuModal);
      switchRulesTab("intro");
      openManagedModal(rulesModal);
    });
  }

  if (soundSettingToggle) {
    soundSettingToggle.addEventListener("change", () => {
      saveSoundPrefs();
      applySoundPrefs(true);
    });
  }

  if (soundVolumeSlider) {
    soundVolumeSlider.addEventListener("input", () => {
      saveSoundPrefs();
      applySoundPrefs(true);
    });
  }

  if (themeChoiceButtons && themeChoiceButtons.length) {
    themeChoiceButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTheme(btn.dataset.theme || "light");
        closeManagedModal(themeModal);
      });
    });
  }

  if (sendFeedbackBtn) {
    sendFeedbackBtn.addEventListener("click", () => {
      const text = feedbackText ? feedbackText.value.trim() : "";
      if (!text) {
        showWinNotification("Hata bildirimi için bir şey yazmalısın.", "warning");
        return;
      }

      socket.emit("feedback", { text });
      if (feedbackText) feedbackText.value = "";
      closeManagedModal(feedbackModal);
      showWinNotification("Hata bildirimin kaydedildi.", "success");
    });
  }

  getManagedModals().forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeManagedModal(modal);
    });
  });
}

const winNotifyContainer = document.getElementById("winNotifyContainer");
const winConfirmOverlay = document.getElementById("winConfirmOverlay");
const winConfirmMessage = document.getElementById("winConfirmMessage");
const winConfirmOkBtn = document.getElementById("winConfirmOkBtn");
const winConfirmCancelBtn = document.getElementById("winConfirmCancelBtn");

function showWinNotification(message, type = "info", duration = 3200) {
  if (!winNotifyContainer) return;

  const box = document.createElement("div");
  box.className = `win-notify ${type}`;
  box.innerHTML = `
    <div class="win-notify-head">
      <div class="win-notify-title">SFD Sketch</div>
      <button class="win-notify-close" type="button">×</button>
    </div>
    <div class="win-notify-message"></div>
  `;

  const msg = box.querySelector(".win-notify-message");
  const closeBtn = box.querySelector(".win-notify-close");
  if (msg) msg.textContent = String(message || "");

  const close = () => {
    if (!box.parentNode) return;
    box.style.opacity = "0";
    box.style.transform = "translateY(8px)";
    setTimeout(() => box.remove(), 160);
  };

  closeBtn?.addEventListener("click", close);
  winNotifyContainer.appendChild(box);

  if (duration > 0) setTimeout(close, duration);
}

function showWinConfirm(message) {
  return new Promise((resolve) => {
    if (!winConfirmOverlay || !winConfirmMessage || !winConfirmOkBtn || !winConfirmCancelBtn) {
      resolve(false);
      return;
    }

    winConfirmMessage.textContent = String(message || "");
    winConfirmOverlay.classList.remove("hidden");

    const cleanup = (result) => {
      winConfirmOverlay.classList.add("hidden");
      winConfirmOkBtn.removeEventListener("click", okHandler);
      winConfirmCancelBtn.removeEventListener("click", cancelHandler);
      resolve(result);
    };

    const okHandler = () => cleanup(true);
    const cancelHandler = () => cleanup(false);

    winConfirmOkBtn.addEventListener("click", okHandler);
    winConfirmCancelBtn.addEventListener("click", cancelHandler);
  });
}

const passwordModal = document.getElementById("passwordModal");
const modalRoomName = document.getElementById("modalRoomName");
const joinPrivatePassword = document.getElementById("joinPrivatePassword");
const confirmPrivateJoinBtn = document.getElementById("confirmPrivateJoinBtn");
const cancelPrivateJoinBtn = document.getElementById("cancelPrivateJoinBtn");

function getManagedModals() {
  return [gameMenuModal, settingsModal, themeModal, feedbackModal, friendsModal, passwordModal, allPlayersModal, rulesModal, adminLobbyModal].filter(Boolean);
}

function refreshModalOpenState() {
  const anyOpen = getManagedModals().some((modal) => !modal.classList.contains("hidden"));
  document.body.classList.toggle("modal-open", anyOpen);
}

function closeManagedModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  refreshModalOpenState();
}

function closeAllManagedModals(exceptModal = null) {
  getManagedModals().forEach((modal) => {
    if (modal !== exceptModal) modal.classList.add("hidden");
  });
  closePlayerContextMenu();
  refreshModalOpenState();
}

function openManagedModal(modal) {
  if (!modal) return;
  closeAllManagedModals(modal);
  modal.classList.remove("hidden");
  refreshModalOpenState();
}

function closeTopmostModal() {
  closePlayerContextMenu();

  if (winConfirmOverlay && !winConfirmOverlay.classList.contains("hidden")) {
    winConfirmOverlay.classList.add("hidden");
    return true;
  }

  const openModal = getManagedModals().find((modal) => !modal.classList.contains("hidden"));
  if (openModal) {
    openModal.classList.add("hidden");
    return true;
  }

  return false;
}

function saveSoundPrefs() {
  try {
    localStorage.setItem("sfd_sound_enabled", soundSettingToggle && soundSettingToggle.checked ? "1" : "0");
    localStorage.setItem("sfd_sound_volume", soundVolumeSlider ? String(soundVolumeSlider.value) : "75");
  } catch (error) {}
}

function applySoundPrefs(playPreview = false) {
  const enabled = !soundSettingToggle || soundSettingToggle.checked;
  const volumePercent = soundVolumeSlider ? Number(soundVolumeSlider.value || 75) : 75;
  const volume = Math.max(0, Math.min(1, volumePercent / 100));
  masterVolumeScale = volume;

  Object.values(sounds).forEach((sound) => {
    sound.muted = !enabled;
    sound.volume = volume;
  });

  if (soundSettingText) {
    soundSettingText.textContent = enabled ? "Açık" : "Kapalı";
  }
  if (soundVolumeValue) {
    soundVolumeValue.textContent = `${volumePercent}%`;
  }

  if (playPreview && enabled) {
    playGameSound("click", Math.max(0.12, Math.min(0.8, volume)), 0);
  }
}

function loadSoundPrefs() {
  try {
    const enabled = localStorage.getItem("sfd_sound_enabled");
    const volume = localStorage.getItem("sfd_sound_volume");

    if (soundSettingToggle && enabled !== null) {
      soundSettingToggle.checked = enabled === "1";
    }
    if (soundVolumeSlider && volume !== null && !Number.isNaN(Number(volume))) {
      soundVolumeSlider.value = String(Math.max(0, Math.min(100, Number(volume))));
    }
  } catch (error) {}

  applySoundPrefs(false);
}

function applyTheme(themeName = "light") {
  const safeTheme = ["light", "mid", "dark"].includes(themeName) ? themeName : "light";
  document.body.classList.remove("theme-light", "theme-mid", "theme-dark");
  document.body.classList.add(`theme-${safeTheme}`);

  if (themeChoiceButtons && themeChoiceButtons.length) {
    themeChoiceButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === safeTheme);
    });
  }

  try {
    localStorage.setItem("sfd_theme", safeTheme);
  } catch (error) {}
}

function loadThemePreference() {
  let themeName = "light";
  try {
    themeName = localStorage.getItem("sfd_theme") || "light";
  } catch (error) {}
  applyTheme(themeName);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (closeTopmostModal()) {
      event.preventDefault();
    }
  }
});


bindTopMenuEvents();
loadSoundPrefs();
loadThemePreference();

function setAuthMessage(message, isError = false) {
  if (!authMessage) return;
  authMessage.textContent = message || "";
  authMessage.classList.toggle("error", Boolean(isError));
}

function hideAllAuthForms() {
  [loginForm, registerForm, verifyForm, forgotPasswordForm, resetPasswordForm].forEach((form) => {
    if (form) form.classList.add("hidden");
  });
}

function showAuthTab(mode) {
  hideAllAuthForms();
  showLoginBtn.classList.toggle("active", mode === "login");
  showRegisterBtn.classList.toggle("active", mode === "register");

  if (mode === "register") {
    registerForm.classList.remove("hidden");
  } else if (mode === "forgot") {
    forgotPasswordForm.classList.remove("hidden");
    setTimeout(() => forgotPasswordEmailInput && forgotPasswordEmailInput.focus(), 20);
  } else if (mode === "reset") {
    resetPasswordForm.classList.remove("hidden");
    showLoginBtn.classList.remove("active");
    showRegisterBtn.classList.remove("active");
    setTimeout(() => resetPasswordInput && resetPasswordInput.focus(), 20);
  } else {
    loginForm.classList.remove("hidden");
  }
}


let resendTimerInterval = null;

function startResendCountdown(ms = 60000) {
  if (!resendCodeBtn) return;

  if (resendTimerInterval) {
    clearInterval(resendTimerInterval);
    resendTimerInterval = null;
  }

  const endAt = Date.now() + Math.max(0, ms);
  resendCodeBtn.disabled = true;

  function tick() {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));

    if (left <= 0) {
      resendCodeBtn.disabled = false;
      resendCodeBtn.textContent = "Tekrar kod gönder";
      clearInterval(resendTimerInterval);
      resendTimerInterval = null;
      return;
    }

    resendCodeBtn.textContent = `Tekrar kod gönder (${left})`;
  }

  tick();
  resendTimerInterval = setInterval(tick, 500);
}

function showVerify(userId, message, resendAfterMs = 60000) {
  pendingVerifyUserId = userId;
  hideAllAuthForms();
  verifyForm.classList.remove("hidden");
  showLoginBtn.classList.remove("active");
  showRegisterBtn.classList.remove("active");
  setAuthMessage(message || "Doğrulama kodlarını gir.", false);
  startResendCountdown(resendAfterMs);
}

async function apiJson(url, options = {}) {
  try {
    const optionHeaders = options && options.headers && typeof options.headers === "object" ? options.headers : {};
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-SFD-Device-ID": sfdDeviceId,
        ...optionHeaders
      },
      credentials: "same-origin"
    });

    const data = await res.json().catch(() => ({
      ok: false,
      message: "Sunucu yanıtı okunamadı."
    }));

    if (!res.ok && data.ok !== false) {
      data.ok = false;
    }

    data.status = res.status;
    return data;
  } catch (error) {
    return {
      ok: false,
      message: "Sunucuya bağlanılamadı. Terminalde npm.cmd start açık mı kontrol et."
    };
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function medalForRank(rank) {
  if (rank === 1) return "⭐";
  if (rank === 2) return "🌟";
  if (rank === 3) return "✨";
  return "";
}

function renderTopList(players = [], target = topList) {
  if (!target) return;

  target.innerHTML = "";
  if (!players.length) {
    target.innerHTML = `<div class="empty-score">Henüz puan yok.</div>`;
    return;
  }

  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = `top-row rank-${player.rank <= 3 ? player.rank : "normal"}`;
    row.innerHTML = `
      <span class="top-rank">${medalForRank(player.rank)} ${player.rank}</span>
      <span class="top-name">${escapeHtml(player.username)}</span>
      <span class="top-score">${player.weeklyScore}</span>
    `;
    target.appendChild(row);
  });
}

async function renderLeaderboard() {
  const data = await apiJson("/api/leaderboard?limit=10");
  if (!data.ok) return;

  renderTopList(data.top10 || [], topList);
  renderTopList(data.top10 || [], topListLoggedIn);

  const rankText = data.me && data.me.username
    ? `${data.me.username} = Sıralaman: ${data.meRank || "-"}`
    : `Sıralaman: ${data.meRank || "-"}`;

  if (myRankBox) myRankBox.textContent = rankText;
  if (myRankBoxLoggedIn) myRankBoxLoggedIn.textContent = rankText;
  if (welcomeRank) welcomeRank.textContent = data.meRank ? `Sıralama: ${data.meRank}` : "Sıralama: -";
}


function setSmallStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
}

function updateFriendsBadge(count = 0) {
  const total = Number(count || 0);
  const badges = [topFriendsBadge, lobbyFriendsBadge].filter(Boolean);

  badges.forEach((badge) => {
    if (total > 0) {
      badge.textContent = total > 99 ? "99+" : String(total);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "0";
      badge.classList.add("hidden");
    }
  });
}

function closePlayerContextMenu() {
  if (!playerContextMenu) return;
  playerContextMenu.classList.add("hidden");
  contextMenuTargetPlayer = null;
}

async function blockPlayerById(userId, messageElement = modalFriendMessage, username = "") {
  const data = await apiJson("/api/user-block", {
    method: "POST",
    body: JSON.stringify({ userId, username })
  });

  setSmallStatus(messageElement, data.message || "İşlem tamam.", !data.ok);
  if (data.ok) {
    latestFriendsData = {
      ...latestFriendsData,
      friends: data.friends || [],
      requests: data.requests || [],
      sentRequests: data.sentRequests || [],
      blockedUsers: data.blockedUsers || [],
      requestCount: Number(data.requestCount || 0)
    };
    updateFriendsBadge(latestFriendsData.requestCount);
    showWinNotification(data.message || "Oyuncu engellendi.", "success", 2600);
    await renderFriends(true);
  } else {
    showWinNotification(data.message || "Oyuncu engellenemedi.", "error", 3200);
  }
  return data;
}


function renderFriendRow(player, type) {
  const row = document.createElement("div");
  row.className = "mini-row";

  if (type === "request") {
    row.innerHTML = `
      <span>${escapeHtml(player.username)}</span>
      <span>
        <button data-action="accept" data-id="${player.id}">Kabul</button>
        <button data-action="reject" data-id="${player.id}">Sil</button>
        <button data-action="block" data-id="${player.id}" class="danger-mini-btn">Engelle</button>
      </span>
    `;
  } else if (type === "blocked") {
    row.innerHTML = `
      <span class="blocked-player-name">${escapeHtml(player.username)}</span>
      <span>
        <button data-action="unblock" data-id="${player.id}">Engeli Kaldır</button>
      </span>
    `;
  } else if (type === "sent") {
    row.innerHTML = `
      <span>${escapeHtml(player.username)}</span>
      <span class="friend-pill pending">Bekliyor</span>
    `;
  } else if (type === "online") {
    row.innerHTML = `
      <span><span class="online-dot"></span>${escapeHtml(player.username)}</span>
      <span>
        <button data-action="remove" data-id="${player.id}">Sil</button>
        <button data-action="block" data-id="${player.id}" class="danger-mini-btn">Engelle</button>
      </span>
    `;
  } else {
    row.innerHTML = `
      <span>${escapeHtml(player.username)}</span>
      <span>
        <button data-action="remove" data-id="${player.id}">Sil</button>
        <button data-action="block" data-id="${player.id}" class="danger-mini-btn">Engelle</button>
      </span>
    `;
  }

  return row;
}

async function renderFriends(silent = false) {
  const data = await apiJson("/api/friends");
  if (!data.ok) {
    if (!silent) {
      updateFriendsBadge(0);
      if (discordPendingBadge) discordPendingBadge.classList.add("hidden");
    }
    return;
  }

  latestFriendsData = {
    friends: data.friends || [],
    requests: data.requests || [],
    sentRequests: data.sentRequests || [],
    blockedUsers: data.blockedUsers || [],
    requestCount: data.requestCount || 0
  };

  updateFriendsBadge(latestFriendsData.requestCount);

  if (discordPendingBadge) {
    const cnt = (latestFriendsData.requests || []).length;
    if (cnt > 0) {
      discordPendingBadge.textContent = cnt > 99 ? "99+" : String(cnt);
      discordPendingBadge.classList.remove("hidden");
    } else {
      discordPendingBadge.textContent = "0";
      discordPendingBadge.classList.add("hidden");
    }
  }

  function fillSimpleLists(requestTarget, friendTarget) {
    if (!requestTarget || !friendTarget) return;

    requestTarget.innerHTML = "";
    friendTarget.innerHTML = "";

    const requests = latestFriendsData.requests || [];
    const friends = latestFriendsData.friends || [];

    if (!requests.length) {
      requestTarget.innerHTML = `<div class="mini-empty">İstek yok.</div>`;
    } else {
      requests.forEach((player) => requestTarget.appendChild(renderFriendRow(player, "request")));
    }

    if (!friends.length) {
      friendTarget.innerHTML = `<div class="mini-empty">Arkadaş yok.</div>`;
    } else {
      friends.forEach((player) => friendTarget.appendChild(renderFriendRow(player, "friend")));
    }
  }

  function renderDiscordList(target, items, type, emptyText) {
    if (!target) return;
    target.innerHTML = "";
    if (!items || !items.length) {
      target.innerHTML = `<div class="discord-empty">${emptyText}</div>`;
      return;
    }
    items.forEach((player) => target.appendChild(renderFriendRow(player, type)));
  }

  fillSimpleLists(friendRequestsList, friendsList);
  renderDiscordList(modalFriendsList, latestFriendsData.friends || [], "friend", "Henüz arkadaşın yok.");
  renderDiscordList(modalOnlineList, latestFriendsData.friends || [], "online", "Şu an çevrimiçi görünen arkadaş yok.");
  renderDiscordList(modalAllFriendsList, latestFriendsData.friends || [], "friend", "Gösterilecek oyuncu yok.");
  renderDiscordList(modalFriendRequestsList, latestFriendsData.requests || [], "request", "Bekleyen gelen istek yok.");
  renderDiscordList(modalSentRequestsList, latestFriendsData.sentRequests || [], "sent", "Gönderilmiş istek yok.");
  renderDiscordList(modalBlockedList, latestFriendsData.blockedUsers || [], "blocked", "Engellenen oyuncu yok.");

  updateDiscordFriendsHeader(activeFriendsTab);
}

async function sendFriendRequestFrom(inputElement, messageElement) {
  const username = inputElement ? inputElement.value.trim() : "";

  if (!username) {
    setSmallStatus(messageElement, "Oyuncu adı yaz.", true);
    return;
  }

  const data = await apiJson("/api/friend-request", {
    method: "POST",
    body: JSON.stringify({ username })
  });

  setSmallStatus(messageElement, data.message || "İşlem tamam.", !data.ok);

  if (data.ok) {
    inputElement.value = "";
    renderFriends();
  }
}

async function handleFriendListClick(event, messageElement) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const userId = button.dataset.id;

  let url = "/api/friend-remove";
  if (action === "accept") url = "/api/friend-accept";
  if (action === "reject") url = "/api/friend-reject";
  if (action === "block") url = "/api/user-block";
  if (action === "unblock") url = "/api/user-unblock";

  const data = await apiJson(url, {
    method: "POST",
    body: JSON.stringify({ userId })
  });

  setSmallStatus(messageElement, data.message || "İşlem tamam.", !data.ok);
  renderFriends(true);
}


async function loadScoreSettings() {
  const data = await apiJson("/api/score-settings");
  if (!data.ok || !data.settings) return;

  if (scoreCorrectMinInput) scoreCorrectMinInput.value = data.settings.correctMin;
  if (scoreTimeMultiplierInput) scoreTimeMultiplierInput.value = data.settings.correctTimeMultiplier;
  if (scoreDrawerBonusInput) scoreDrawerBonusInput.value = data.settings.drawerBonus;
  if (scoreHintPenaltyInput) scoreHintPenaltyInput.value = data.settings.hintPenalty;
  if (scoreAwardRankGroupsInput) scoreAwardRankGroupsInput.value = data.settings.globalAwardRankGroups;
}


function renderAuthState(data) {
  currentAuthUser = data && data.user ? data.user : null;

  if (currentAuthUser) {
    authPanel.classList.add("hidden");
    roomPanel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    if (rulesBtn) rulesBtn.classList.remove("hidden");
    if (lobbySettingsBtn) lobbySettingsBtn.classList.remove("hidden");
    if (lobbyFriendsBtn) lobbyFriendsBtn.classList.remove("hidden");
    if (lobbyAdminBtn) lobbyAdminBtn.classList.toggle("hidden", currentAuthUser.isAdmin !== true);
    syncAdminStealthControls();
    renderFriends(true);
    document.body.classList.toggle("admin-session", currentAuthUser.isAdmin === true);
    if (welcomeUser) welcomeUser.textContent = currentAuthUser.displayName || currentAuthUser.username;
    if (welcomeRank) welcomeRank.textContent = currentAuthUser.isAdmin === true
      ? "Yönetici Hesabı"
      : (data.rank ? `Sıralama: ${data.rank}` : "Sıralama: -");
    renderFriends();
    loadScoreSettings();
  } else {
    document.body.classList.remove("admin-session");
    if (adminToolbar) adminToolbar.classList.add("hidden");
    authPanel.classList.remove("hidden");
    roomPanel.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    if (rulesBtn) rulesBtn.classList.add("hidden");
    if (lobbySettingsBtn) lobbySettingsBtn.classList.add("hidden");
    if (lobbyFriendsBtn) lobbyFriendsBtn.classList.add("hidden");
    if (lobbyAdminBtn) lobbyAdminBtn.classList.add("hidden");
    if (adminLobbyModal) adminLobbyModal.classList.add("hidden");
    latestFriendsData = { friends: [], requests: [], sentRequests: [], blockedUsers: [], requestCount: 0 };
    updateFriendsBadge(0);
  }

  renderLeaderboard();
}

function playerDisplayName() {
  return currentAuthUser ? (currentAuthUser.displayName || currentAuthUser.username) : "";
}

async function loadMe() {
  const data = await apiJson("/api/me");
  renderAuthState(data);
  if (data && data.banned === true) {
    showPermanentBanScreen(data.message);
  }
}


async function checkSessionStillValid() {
  if (forcedBanLocked) return;
  const data = await apiJson("/api/me");
  if (data && data.banned === true) {
    showPermanentBanScreen(data.message);
    return;
  }
  if (!data.ok || !data.user) {
    if (currentAuthUser && !forcedBanLocked) {
      location.reload();
    }
  }
}

window.addEventListener("focus", () => {
  checkSessionStillValid();
});



if (loginPasswordInput) {
  loginPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && loginBtn) {
      loginBtn.click();
    }
  });
}


if (sendFriendRequestBtn) {
  sendFriendRequestBtn.addEventListener("click", () => {
    sendFriendRequestFrom(friendUsernameInput, friendMessage);
  });
}

if (modalSendFriendRequestBtn) {
  modalSendFriendRequestBtn.addEventListener("click", () => {
    sendFriendRequestFrom(modalFriendUsernameInput, modalFriendMessage);
  });
}

if (friendRequestsList) {
  friendRequestsList.addEventListener("click", (event) => {
    handleFriendListClick(event, friendMessage);
  });
}

if (friendsList) {
  friendsList.addEventListener("click", (event) => {
    handleFriendListClick(event, friendMessage);
  });
}

if (modalFriendRequestsList) {
  modalFriendRequestsList.addEventListener("click", (event) => {
    handleFriendListClick(event, modalFriendMessage);
  });
}

if (modalFriendsList) {
  modalFriendsList.addEventListener("click", (event) => {
    handleFriendListClick(event, modalFriendMessage);
  });
}

if (modalOnlineList) {
  modalOnlineList.addEventListener("click", (event) => {
    handleFriendListClick(event, modalFriendMessage);
  });
}

if (modalAllFriendsList) {
  modalAllFriendsList.addEventListener("click", (event) => {
    handleFriendListClick(event, modalFriendMessage);
  });
}

if (modalBlockedList) {
  modalBlockedList.addEventListener("click", (event) => {
    handleFriendListClick(event, modalFriendMessage);
  });
}

if (discordFriendTabs && discordFriendTabs.length) {
  discordFriendTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchFriendsTab(btn.dataset.tab || "add"));
  });
}

if (settingsFriendsBtn) {
  settingsFriendsBtn.addEventListener("click", () => {
    renderFriends();
    switchFriendsTab("add");
    openManagedModal(friendsModal);
  });
}

if (topFriendsBtn) {
  topFriendsBtn.addEventListener("click", () => {
    renderFriends();
    switchFriendsTab("add");
    openManagedModal(friendsModal);
  });
}

if (lobbySettingsBtn) {
  lobbySettingsBtn.addEventListener("click", () => {
    openManagedModal(settingsModal);
  });
}

if (lobbyFriendsBtn) {
  lobbyFriendsBtn.addEventListener("click", () => {
    renderFriends();
    switchFriendsTab("add");
    openManagedModal(friendsModal);
  });
}

if (friendsModalCloseBtn) {
  friendsModalCloseBtn.addEventListener("click", () => {
    closeManagedModal(friendsModal);
  });
}

if (friendsModal) {
  friendsModal.addEventListener("click", (e) => {
    if (e.target === friendsModal) {
      closeManagedModal(friendsModal);
    }
  });
}

if (saveScoreSettingsBtn) {
  saveScoreSettingsBtn.addEventListener("click", async () => {
    const data = await apiJson("/api/score-settings", {
      method: "POST",
      body: JSON.stringify({
        correctMin: scoreCorrectMinInput.value,
        correctTimeMultiplier: scoreTimeMultiplierInput.value,
        drawerBonus: scoreDrawerBonusInput.value,
        hintPenalty: scoreHintPenaltyInput.value,
        globalAwardRankGroups: scoreAwardRankGroupsInput.value
      })
    });

    setSmallStatus(scoreSettingsMessage, data.message || "Kaydedildi.", !data.ok);
    if (data.ok) loadScoreSettings();
  });
}


if (showLoginBtn) showLoginBtn.addEventListener("click", () => showAuthTab("login"));
if (showRegisterBtn) showRegisterBtn.addEventListener("click", () => showAuthTab("register"));

if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", () => {
    setAuthMessage("", false);
    if (forgotPasswordEmailInput && loginUserInput && loginUserInput.value.includes("@")) {
      forgotPasswordEmailInput.value = loginUserInput.value.trim();
    }
    showAuthTab("forgot");
  });
}

if (backToLoginFromForgotBtn) {
  backToLoginFromForgotBtn.addEventListener("click", () => {
    setAuthMessage("", false);
    showAuthTab("login");
  });
}

if (backToLoginFromResetBtn) {
  backToLoginFromResetBtn.addEventListener("click", () => {
    pendingPasswordResetToken = "";
    history.replaceState({}, document.title, location.pathname);
    setAuthMessage("", false);
    showAuthTab("login");
  });
}

async function requestPasswordReset() {
  const email = forgotPasswordEmailInput ? forgotPasswordEmailInput.value.trim() : "";

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setAuthMessage("Geçerli bir e-posta adresi yazmalısın.", true);
    if (forgotPasswordEmailInput) forgotPasswordEmailInput.focus();
    return;
  }

  sendPasswordResetBtn.disabled = true;
  const oldText = sendPasswordResetBtn.textContent;
  sendPasswordResetBtn.textContent = "Gönderiliyor...";
  setAuthMessage("Sıfırlama bağlantısı hazırlanıyor...", false);

  const data = await apiJson("/api/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });

  setAuthMessage(data.message || (data.ok ? "Bağlantı gönderildi." : "Bağlantı gönderilemedi."), !data.ok);
  sendPasswordResetBtn.disabled = false;
  sendPasswordResetBtn.textContent = oldText;
}

if (sendPasswordResetBtn) {
  sendPasswordResetBtn.addEventListener("click", requestPasswordReset);
}

if (forgotPasswordEmailInput) {
  forgotPasswordEmailInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") requestPasswordReset();
  });
}

async function completePasswordReset() {
  const password = resetPasswordInput ? resetPasswordInput.value : "";
  const passwordAgain = resetPasswordAgainInput ? resetPasswordAgainInput.value : "";

  if (!pendingPasswordResetToken) {
    setAuthMessage("Şifre sıfırlama bağlantısı geçersiz.", true);
    return;
  }

  if (password.length < 6) {
    setAuthMessage("Yeni şifre en az 6 karakter olmalı.", true);
    return;
  }

  if (password !== passwordAgain) {
    setAuthMessage("Yeni şifreler aynı değil.", true);
    return;
  }

  completePasswordResetBtn.disabled = true;
  const oldText = completePasswordResetBtn.textContent;
  completePasswordResetBtn.textContent = "Şifre yenileniyor...";

  const data = await apiJson("/api/password-reset/complete", {
    method: "POST",
    body: JSON.stringify({
      token: pendingPasswordResetToken,
      password,
      passwordAgain
    })
  });

  if (data.ok) {
    pendingPasswordResetToken = "";
    history.replaceState({}, document.title, location.pathname);
    if (resetPasswordInput) resetPasswordInput.value = "";
    if (resetPasswordAgainInput) resetPasswordAgainInput.value = "";
    showAuthTab("login");
    setAuthMessage(data.message || "Şifren yenilendi. Giriş yapabilirsin.", false);
  } else {
    setAuthMessage(data.message || "Şifre yenilenemedi.", true);
  }

  completePasswordResetBtn.disabled = false;
  completePasswordResetBtn.textContent = oldText;
}

if (completePasswordResetBtn) {
  completePasswordResetBtn.addEventListener("click", completePasswordReset);
}

[resetPasswordInput, resetPasswordAgainInput].forEach((input) => {
  if (!input) return;
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") completePasswordReset();
  });
});

async function openPasswordResetFromUrl() {
  const token = new URLSearchParams(location.search).get("reset") || "";
  if (!token) return;

  pendingPasswordResetToken = token;
  showAuthTab("reset");
  setAuthMessage("Şifre sıfırlama bağlantısı kontrol ediliyor...", false);

  const data = await apiJson(`/api/password-reset/validate?token=${encodeURIComponent(token)}`);
  if (!data.ok) {
    pendingPasswordResetToken = "";
    if (completePasswordResetBtn) completePasswordResetBtn.disabled = true;
    setAuthMessage(data.message || "Bağlantı geçersiz veya süresi dolmuş.", true);
    return;
  }

  if (completePasswordResetBtn) completePasswordResetBtn.disabled = false;
  setAuthMessage("Bağlantı doğrulandı. Yeni şifreni belirleyebilirsin.", false);
}

openPasswordResetFromUrl();

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const loginValue = loginUserInput.value.trim();
    const passwordValue = loginPasswordInput.value;

    if (!loginValue || !passwordValue) {
      setAuthMessage("Kullanıcı adı/e-posta ve şifre yazmalısın.", true);
      return;
    }

    loginBtn.disabled = true;
    const oldText = loginBtn.textContent;
    loginBtn.textContent = "Giriş yapılıyor...";
    setAuthMessage("Giriş kontrol ediliyor...", false);

    try {
      const data = await apiJson("/api/login", {
        method: "POST",
        body: JSON.stringify({
          login: loginValue,
          password: passwordValue
        })
      });

      if (data.ok) {
        setAuthMessage("Giriş başarılı. Sayfa yenileniyor...");
        setTimeout(() => location.reload(), 350);
        return;
      }

      if (data.needsVerification) {
        showVerify(data.userId, data.message, data.resendAfterMs || 60000);
        return;
      }

      setAuthMessage(data.message || "Giriş yapılamadı.", true);
    } catch (error) {
      setAuthMessage("Giriş sırasında hata oldu: " + error.message, true);
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = oldText;
    }
  });
}



function fillBirthSelects() {
  if (!regBirthDayInput || !regBirthMonthInput) return;

  if (regBirthDayInput.options.length <= 1) {
    for (let day = 1; day <= 31; day++) {
      const option = document.createElement("option");
      option.value = String(day).padStart(2, "0");
      option.textContent = String(day).padStart(2, "0");
      regBirthDayInput.appendChild(option);
    }
  }

  if (regBirthMonthInput.options.length <= 1) {
    const months = [
      "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
      "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
    ];

    months.forEach((name, index) => {
      const option = document.createElement("option");
      option.value = String(index + 1).padStart(2, "0");
      option.textContent = name;
      regBirthMonthInput.appendChild(option);
    });
  }
}

function validateBirthDateClient(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const currentYear = new Date().getFullYear();

  if (!d || !m || !y) {
    return { ok: false, message: "Doğum gün, ay ve yıl seçmelisin." };
  }

  if (y < 1940 || y > currentYear - 5) {
    return { ok: false, message: "Doğum yılı geçerli değil." };
  }

  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return { ok: false, message: "Doğum tarihi geçerli değil." };
  }

  return {
    ok: true,
    birthDay: String(d).padStart(2, "0"),
    birthMonth: String(m).padStart(2, "0"),
    birthYear: y
  };
}

fillBirthSelects();

function normalizePhoneInput(value) {
  let clean = String(value || "").replace(/\D/g, "");

  if (clean.length === 12 && clean.startsWith("90")) {
    clean = "0" + clean.slice(2);
  }

  return clean.slice(0, 11);
}

function validateTurkishPhoneClient(value) {
  const clean = normalizePhoneInput(value);

  if (!/^05\d{9}$/.test(clean)) {
    return {
      ok: false,
      phone: clean,
      message: "Telefon 11 haneli olmalı ve 05 ile başlamalı. Örnek: 05449656103"
    };
  }

  const withoutZero = clean.slice(1);

  if (/^(\d)\1+$/.test(withoutZero)) {
    return {
      ok: false,
      phone: clean,
      message: "Geçerli bir telefon numarası yazmalısın."
    };
  }

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

if (regPhoneInput) {
  regPhoneInput.addEventListener("input", () => {
    regPhoneInput.value = normalizePhoneInput(regPhoneInput.value);
  });
}

if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    const birthCheck = validateBirthDateClient(
      regBirthDayInput.value,
      regBirthMonthInput.value,
      regBirthYearInput.value
    );

    if (!birthCheck.ok) {
      setAuthMessage(birthCheck.message, true);
      regBirthYearInput.focus();
      return;
    }

    const phoneCheck = validateTurkishPhoneClient(regPhoneInput.value);

    if (!phoneCheck.ok) {
      setAuthMessage(phoneCheck.message, true);
      regPhoneInput.focus();
      return;
    }

    const data = await apiJson("/api/register", {
      method: "POST",
      body: JSON.stringify({
        firstName: regFirstNameInput.value,
        lastName: regLastNameInput.value,
        username: regUsernameInput.value,
        birthDay: birthCheck.birthDay,
        birthMonth: birthCheck.birthMonth,
        birthYear: birthCheck.birthYear,
        email: regEmailInput.value,
        phone: phoneCheck.phone,
        password: regPasswordInput.value,
        passwordAgain: regPasswordAgainInput.value
      })
    });

    if (data.ok) {
      showVerify(data.userId, data.message, data.resendAfterMs || 60000);
    } else {
      setAuthMessage(data.message || "Kayıt yapılamadı.", true);
    }
  });
}


if (resendCodeBtn) {
  resendCodeBtn.addEventListener("click", async () => {
    if (!pendingVerifyUserId || resendCodeBtn.disabled) return;

    const data = await apiJson("/api/resend-code", {
      method: "POST",
      body: JSON.stringify({
        userId: pendingVerifyUserId
      })
    });

    if (data.ok) {
      setAuthMessage(data.message || "Yeni kod gönderildi.");
      startResendCountdown(data.resendAfterMs || 60000);
    } else {
      setAuthMessage(data.message || "Kod gönderilemedi.", true);
      startResendCountdown(data.resendAfterMs || 10000);
    }
  });
}

if (verifyBtn) {
  verifyBtn.addEventListener("click", async () => {
    const data = await apiJson("/api/verify", {
      method: "POST",
      body: JSON.stringify({
        userId: pendingVerifyUserId,
        emailCode: emailCodeInput.value
      })
    });

    if (data.ok) {
      setAuthMessage("Doğrulama başarılı. Sayfa yenileniyor...");
      setTimeout(() => location.reload(), 350);
    } else {
      setAuthMessage(data.message || "Doğrulama başarısız.", true);
    }
  });
}


function switchRulesTab(tabName) {
  rulesTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.rulesTab === tabName);
  });
  rulesPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.rulesPanel === tabName);
  });
  const content = rulesModal ? rulesModal.querySelector(".rules-content") : null;
  if (content) content.scrollTop = 0;
}

if (rulesBtn) {
  rulesBtn.addEventListener("click", () => {
    switchRulesTab("intro");
    openManagedModal(rulesModal);
  });
}

if (rulesCloseBtn) {
  rulesCloseBtn.addEventListener("click", () => closeManagedModal(rulesModal));
}

rulesTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    switchRulesTab(tab.dataset.rulesTab || "intro");
  });
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await apiJson("/api/logout", { method: "POST" });

    try {
      localStorage.setItem("sfd_logout_at", String(Date.now()));
    } catch (error) {}

    location.reload();
  });
}

if (refreshLeaderboardBtn) refreshLeaderboardBtn.addEventListener("click", renderLeaderboard);


async function openAllPlayersModal() {
  const data = await apiJson("/api/leaderboard?limit=1000");
  allPlayersList.innerHTML = "";

  (data.players || []).forEach((player) => {
    const row = document.createElement("div");
    row.className = `top-row rank-${player.rank <= 3 ? player.rank : "normal"}`;
    row.innerHTML = `
      <span class="top-rank">${medalForRank(player.rank)} ${player.rank}</span>
      <span class="top-name">${escapeHtml(player.username)}</span>
      <span class="top-score">${player.weeklyScore}</span>
    `;
    allPlayersList.appendChild(row);
  });

  allPlayersModal.classList.remove("hidden");
}

if (showAllPlayersBtn) {
  showAllPlayersBtn.addEventListener("click", openAllPlayersModal);
}

if (showAllPlayersBtnLoggedIn) {
  showAllPlayersBtnLoggedIn.addEventListener("click", openAllPlayersModal);
}

if (closeAllPlayersBtn) {
  closeAllPlayersBtn.addEventListener("click", () => closeManagedModal(allPlayersModal));
}

loadMe();
setInterval(renderLeaderboard, 30000);

let selectedPrivateRoomId = null;

const roomNameText = document.getElementById("roomNameText");
const roundText = document.getElementById("roundText");
const totalRoundText = document.getElementById("totalRoundText");
const wordText = document.getElementById("wordText");
const drawerText = document.getElementById("drawerText");
const drawerSecretWord = document.getElementById("drawerSecretWord");
const timerCircle = document.getElementById("timerCircle");
const userCountText = document.getElementById("userCountText");

const playersList = document.getElementById("playersList");
const awayToggleBtn = document.getElementById("awayToggleBtn");
const gameMessages = document.getElementById("gameMessages");
const chatMessages = document.getElementById("chatMessages");
const chatPanel = document.querySelector(".chat-panel");

const messageComposerShell = document.getElementById("messageComposerShell");
const mainMessageInput = document.getElementById("mainMessageInput");

// V60: iPhone klavyesinin her dokunuşta yeniden kurulmasına yol açan alan adı
// değiştirme kaldırıldı. Alan kimliği sayfa boyunca sabit kalır; böylece yazma,
// silme ve tekrar gönderme daha hızlı olur.
if (mainMessageInput) {
  const stableFieldName = `sfd-live-message-${Date.now()}`;
  mainMessageInput.setAttribute("name", stableFieldName);
  mainMessageInput.setAttribute("autocomplete", "off");
  mainMessageInput.setAttribute("autocorrect", "off");
  mainMessageInput.setAttribute("autocapitalize", "off");
  mainMessageInput.setAttribute("spellcheck", "false");
  mainMessageInput.setAttribute("inputmode", "text");
  mainMessageInput.setAttribute("enterkeyhint", "send");
  mainMessageInput.setAttribute("aria-autocomplete", "none");
  mainMessageInput.setAttribute("data-lpignore", "true");
  mainMessageInput.setAttribute("data-1p-ignore", "true");
  mainMessageInput.setAttribute("data-bwignore", "true");
  mainMessageInput.setAttribute("data-form-type", "other");
  window.addEventListener("pagehide", () => { mainMessageInput.value = ""; });
}
const whisperTargetBox = document.getElementById("whisperTargetBox");
const whisperTargetInput = document.getElementById("whisperTargetInput");
const whisperTargetAcceptBtn = document.getElementById("whisperTargetAcceptBtn");
const whisperTargetCloseBtn = document.getElementById("whisperTargetCloseBtn");
const sendMainMessageBtn = document.getElementById("sendMainMessageBtn");
const chatEmojiBtn = document.getElementById("chatEmojiBtn");
const chatEmojiPicker = document.getElementById("chatEmojiPicker");
const chatEmojiCloseBtn = document.getElementById("chatEmojiCloseBtn");
const emojiSearchInput = document.getElementById("emojiSearchInput");
const emojiCategoryTabs = document.getElementById("emojiCategoryTabs");
const emojiGrid = document.getElementById("emojiGrid");
const emojiRecentRow = document.getElementById("emojiRecentRow");

const hintBtn = document.getElementById("hintBtn");
const skipBtn = document.getElementById("skipBtn");
const doneBtn = document.getElementById("doneBtn");
const clearBtn = document.getElementById("clearBtn");
const earHintBtn = document.getElementById("earHintBtn");
const earHintIndicator = document.getElementById("earHintIndicator");
const intermissionOverlay = document.getElementById("intermissionOverlay");
const intermissionWord = document.getElementById("intermissionWord");
const intermissionCountdown = document.getElementById("intermissionCountdown");
const skipVoteOverlay = document.getElementById("skipVoteOverlay");
const skipVoteDescription = document.getElementById("skipVoteDescription");
const skipVoteProgress = document.getElementById("skipVoteProgress");
const skipVoteYesBtn = document.getElementById("skipVoteYesBtn");
const skipVoteNoBtn = document.getElementById("skipVoteNoBtn");
const skipVoteLockedText = document.getElementById("skipVoteLockedText");
const skipVoteCloseBtn = document.getElementById("skipVoteCloseBtn");

const viewerStatus = document.getElementById("viewerStatus");
const viewerStatusText = document.getElementById("viewerStatusText");
const afkVoteBtn = document.getElementById("afkVoteBtn");
const afkVoteWarningImg = afkVoteBtn ? afkVoteBtn.querySelector(".afk-vote-warning-image") : null;
const AFK_VOTE_ICON_YELLOW = "/images/afk_vote_warning.png?v=vote-rules-v15-20260613";
const AFK_VOTE_ICON_RED = "/images/afk_vote_warning_red.png?v=vote-rules-v15-20260613";

function setAfkVoteAlertIcon(isRed = false) {
  if (!afkVoteWarningImg) return;
  const target = isRed ? AFK_VOTE_ICON_RED : AFK_VOTE_ICON_YELLOW;
  if (afkVoteWarningImg.getAttribute("src") !== target) {
    afkVoteWarningImg.setAttribute("src", target);
  }
}
const afkVoteCountText = document.getElementById("afkVoteCountText");
applyRightColumnMode("waiting-mode");
const drawToolsBar = document.getElementById("drawToolsBar");

const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const winnerOverlay = document.getElementById("winnerOverlay");
const winnerFireworksLayer = document.getElementById("winnerFireworks");
const winnerConfettiLayer = document.getElementById("winnerConfetti");
const winnerNameText = document.getElementById("winnerName");
const winnerScoreText = document.getElementById("winnerScore");
const winnerCountdownText = document.getElementById("winnerCountdown");

const lineWidthInput = document.getElementById("lineWidth");
const sizeValue = document.getElementById("sizeValue");
const colorPalette = document.getElementById("colorPalette");
const customColorPicker = document.getElementById("customColorPicker");
const toolButtons = document.querySelectorAll(".tool-btn[data-tool]");
const brushPresetButtons = document.querySelectorAll(".brush-preset-btn[data-brush-size]");

let drawing = false;
let currentColor = "#000000";
let currentTool = "pencil";
let currentRoomId = null;
let currentDrawerId = null;
let mySocketId = null;
let isMyTurn = false;
let activeMessageMode = null;
let iHaveGuessed = false;
let iAmAway = false;
let hintAvailable = true;
let canFinishTurn = false;
let skipAvailable = true;
let winnerOverlayTimer = null;
let winnerCountdownInterval = null;
let winnerSoundStopTimer = null;
let currentSecretWord = "";
let currentMaskedWord = "";
let currentHintActive = false;
let currentGameStatus = "waiting";
let latestPlayers = [];
let previousGameStatus = "waiting";
let afkVoteActive = false;
let afkVoteCount = 0;
let afkVoteNeeded = 3;
let afkVotedByMe = false;
let afkVoteSubmitting = false;
let afkVoteCooldownUntil = 0;
let afkVoteCooldownTimer = null;
let warningButtonVisible = false;
let warningButtonEnabled = false;
let warningAlreadyUsed = false;
let warningUsesLeft = 5;
let voteActivePlayerCount = 0;
let voteMinimumActivePlayers = 3;
let voteLockedUntilRoundComplete = false;
let skipVoteActive = false;
let skipVoteCanVote = false;
let skipVoteHasVoted = false;
let skipVoteYesCount = 0;
let skipVoteNoCount = 0;
let skipVoteRequired = 0;
let skipVoteEndsAt = 0;
let skipVoteFastTrack = false;
let skipVoteIsInitiator = false;
let skipVoteShouldAlert = false;
let skipVotePanelOpened = false;
// V12: Oylama çağrısı state güncellemelerinde kaybolmasın diye istemcide kilitlenir.
let skipVoteAlertLocked = false;
let skipVoteAlertBlinkOn = false;
let skipVoteAlertBlinkTimer = null;
let skipVoteCountdownTimer = null;
let earHintActive = false;
let lastX = 0;
let lastY = 0;

let shapeStartX = 0;
let shapeStartY = 0;
let isShapeDrawing = false;
let shapePreviewImage = null;
let isShiftPressed = false;

const colors = [
  "#000000", "#ffffff", "#666666", "#999999", "#cccccc",
  "#d32f2f", "#f44336", "#ff6b6b", "#ff8a80", "#ff9800",
  "#ffb74d", "#ffd54f", "#ffe082", "#2e7d32", "#43a047",
  "#66bb6a", "#81c784", "#b9f6ca", "#00695c", "#00897b",
  "#26a69a", "#4dd0e1", "#80deea", "#1565c0", "#1e88e5",
  "#42a5f5", "#90caf9", "#bbdefb", "#6a1b9a", "#8e24aa"
];

function isShapeTool(tool) {
  return tool === "circle" || tool === "box" || tool === "line";
}

function buildColorPalette() {
  colorPalette.innerHTML = "";

  colors.forEach((color, index) => {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = color;
    swatch.dataset.color = color;

    if (index === 0) {
      swatch.classList.add("selected");
    }

    swatch.addEventListener("click", () => {
      currentColor = color;
      customColorPicker.value = color;

      document.querySelectorAll(".color-swatch").forEach((item) => {
        item.classList.remove("selected");
      });

      swatch.classList.add("selected");

      if (currentTool === "eraser") {
        setTool("pencil");
      }
    });

    colorPalette.appendChild(swatch);
  });
}

buildColorPalette();

customColorPicker.addEventListener("input", (event) => {
  currentColor = event.target.value;

  document.querySelectorAll(".color-swatch").forEach((item) => {
    item.classList.remove("selected");
  });

  if (currentTool === "eraser") {
    setTool("pencil");
  }
});

lineWidthInput.addEventListener("input", () => {
  sizeValue.textContent = lineWidthInput.value;
  brushPresetButtons.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.brushSize) === Number(lineWidthInput.value));
  });
});

brushPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const size = Math.max(1, Math.min(40, Number(button.dataset.brushSize || 2)));
    lineWidthInput.value = String(size);
    sizeValue.textContent = String(size);
    brushPresetButtons.forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Shift") {
    isShiftPressed = true;
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Shift") {
    isShiftPressed = false;
  }
});

window.addEventListener("blur", () => {
  isShiftPressed = false;
});

function setTool(toolName) {
  currentTool = toolName;

  toolButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === toolName);
  });
}

toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setTool(btn.dataset.tool);
  });
});

clearBtn.addEventListener("click", () => {
  if (!isMyTurn) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clearCanvas");
});

function getPlayerName() {
  return playerDisplayName();
}

const expandedRoomThemes = {};

function handleJoinRoom(room, isPrivate) {
  const playerName = getPlayerName();
  if (!currentAuthUser) {
    showWinNotification("Odaya girmek için önce kayıt olup giriş yapmalısın.", "warning");
    return;
  }
  if (!playerName) {
    showWinNotification("Oyuncu hesabı bulunamadı.", "error");
    return;
  }
  if (isPrivate) {
    selectedPrivateRoomId = room.id;
    modalRoomName.textContent = room.name;
    joinPrivatePassword.value = "";
    openManagedModal(passwordModal);
    return;
  }
  socket.emit("joinRoom", { roomId: room.id, playerName, adminHidden: currentAdminStealthPreference() });
}

function createRoomItem(room, isPrivate) {
  const item = document.createElement("div");
  item.className = "room-item";
  const statusText = room.status === "playing" ? "Oyunda" : (room.status === "intermission" ? "Tur Arası" : "Bekliyor");
  const lockText = isPrivate ? "🔒" : "🌍";
  item.innerHTML = `
    <div>
      <div class="room-name">${lockText} ${escapeHtml(room.name)}</div>
      <div class="room-meta">${room.playerCount}/${room.maxPlayers} oyuncu - ${statusText}${room.customWordCount ? ` - ${room.customWordCount} özel kelime` : ""}</div>
    </div>
    <button type="button">Gir</button>
  `;
  item.addEventListener("click", () => handleJoinRoom(room, isPrivate));
  item.querySelector("button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleJoinRoom(room, isPrivate);
  });
  return item;
}

function renderGlobalRoomGroups(rooms) {
  globalRoomsList.innerHTML = "";

  const categoryOrder = ["mixed", "films", "animals"];
  const difficultyOrder = ["easy", "medium", "hard"];
  const categories = new Map();

  (rooms || []).forEach((room) => {
    const categoryKey = room.themeGroupKey || String(room.themeKey || "mixed").split("_")[0];
    const categoryLabel = room.themeGroupLabel || ({ mixed: "Karışık", films: "Filmler", animals: "Hayvanlar" }[categoryKey] || room.themeLabel || room.name);
    const difficultyKey = room.difficultyKey || String(room.themeKey || "").split("_")[1] || "medium";
    const difficultyLabel = room.difficultyLabel || ({ easy: "Kolay", medium: "Orta", hard: "Zor" }[difficultyKey] || "Orta");

    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, { key: categoryKey, label: categoryLabel, difficulties: new Map() });
    }
    const category = categories.get(categoryKey);
    if (!category.difficulties.has(difficultyKey)) {
      category.difficulties.set(difficultyKey, { key: difficultyKey, label: difficultyLabel, rooms: [] });
    }
    category.difficulties.get(difficultyKey).rooms.push(room);
  });

  const orderedCategories = [...categories.values()].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.key);
    const bi = categoryOrder.indexOf(b.key);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  orderedCategories.forEach((category) => {
    const categoryStateKey = `category:${category.key}`;
    if (typeof expandedRoomThemes[categoryStateKey] !== "boolean") {
      expandedRoomThemes[categoryStateKey] = false;
    }
    const categoryExpanded = expandedRoomThemes[categoryStateKey];

    const allCategoryRooms = [...category.difficulties.values()].flatMap((item) => item.rooms);
    const totalPlayers = allCategoryRooms.reduce((sum, room) => sum + Number(room.playerCount || 0), 0);

    const wrap = document.createElement("div");
    wrap.className = "room-theme-group room-category-group";

    const categoryVisuals = {
      mixed: { icon: "✦", subtitle: "Her türden çizilebilir kelime" },
      films: { icon: "▶", subtitle: "Yerli ve yabancı filmler" },
      animals: { icon: "◆", subtitle: "Hayvanlar dünyası" }
    };
    const categoryVisual = categoryVisuals[category.key] || { icon: "•", subtitle: "Oda seçenekleri" };

    const header = document.createElement("button");
    header.type = "button";
    header.className = `room-theme-toggle room-category-toggle category-${category.key}`;
    header.innerHTML = `
      <span class="room-category-main">
        <span class="room-category-icon" aria-hidden="true">${categoryVisual.icon}</span>
        <span class="room-category-copy">
          <strong>${escapeHtml(category.label)}</strong>
          <small>${escapeHtml(categoryVisual.subtitle)}</small>
        </span>
      </span>
      <span class="room-theme-summary">${allCategoryRooms.length} oda · ${totalPlayers} oyuncu <b>${categoryExpanded ? "▾" : "▸"}</b></span>
    `;

    const categoryBody = document.createElement("div");
    categoryBody.className = "room-theme-body room-category-body" + (categoryExpanded ? "" : " hidden");

    const orderedDifficulties = [...category.difficulties.values()].sort((a, b) => {
      const ai = difficultyOrder.indexOf(a.key);
      const bi = difficultyOrder.indexOf(b.key);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    orderedDifficulties.forEach((difficulty) => {
      difficulty.rooms.sort((a, b) => Number(a.instanceNumber || 0) - Number(b.instanceNumber || 0));
      const difficultyStateKey = `difficulty:${category.key}:${difficulty.key}`;
      if (typeof expandedRoomThemes[difficultyStateKey] !== "boolean") expandedRoomThemes[difficultyStateKey] = false;
      const difficultyExpanded = expandedRoomThemes[difficultyStateKey];
      const difficultyPlayers = difficulty.rooms.reduce((sum, room) => sum + Number(room.playerCount || 0), 0);

      const difficultyWrap = document.createElement("div");
      difficultyWrap.className = `room-difficulty-group difficulty-${difficulty.key}`;

      const difficultyHeader = document.createElement("button");
      difficultyHeader.type = "button";
      difficultyHeader.className = "room-difficulty-toggle";
      difficultyHeader.innerHTML = `<span>${escapeHtml(difficulty.label)}</span><span>${difficulty.rooms.length} oda · ${difficultyPlayers} oyuncu <b>${difficultyExpanded ? "▾" : "▸"}</b></span>`;

      const difficultyBody = document.createElement("div");
      difficultyBody.className = "room-difficulty-body" + (difficultyExpanded ? "" : " hidden");
      difficulty.rooms.forEach((room) => difficultyBody.appendChild(createRoomItem(room, false)));

      difficultyHeader.addEventListener("click", () => {
        expandedRoomThemes[difficultyStateKey] = !expandedRoomThemes[difficultyStateKey];
        renderGlobalRoomGroups(rooms);
      });

      difficultyWrap.appendChild(difficultyHeader);
      difficultyWrap.appendChild(difficultyBody);
      categoryBody.appendChild(difficultyWrap);
    });

    header.addEventListener("click", () => {
      const willExpand = !expandedRoomThemes[categoryStateKey];

      Object.keys(expandedRoomThemes).forEach((key) => {
        if (key.startsWith("category:")) {
          expandedRoomThemes[key] = false;
        }
      });

      expandedRoomThemes[categoryStateKey] = willExpand;
      renderGlobalRoomGroups(rooms);
    });

    wrap.appendChild(header);
    wrap.appendChild(categoryBody);
    globalRoomsList.appendChild(wrap);
  });
}

function renderRoomList(listElement, rooms, isPrivate) {
  listElement.innerHTML = "";
  if (!rooms || !rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-item";
    empty.textContent = "Oda yok";
    listElement.appendChild(empty);
    return;
  }
  rooms.forEach((room) => listElement.appendChild(createRoomItem(room, isPrivate)));
}

socket.on("roomsList", ({ globalRooms, privateRooms }) => {
  renderGlobalRoomGroups(globalRooms || []);
  renderRoomList(privateRoomsList, privateRooms, true);
});

socket.on("roomAutoRedirected", ({ message } = {}) => {
  if (message) showWinNotification(message, "info", 4500);
});

createPrivateRoomBtn.addEventListener("click", () => {
  const playerName = getPlayerName();
  const roomName = privateRoomNameInput.value.trim();
  const password = privateRoomPasswordInput.value.trim();

  if (!currentAuthUser) {
    showWinNotification("Özel oda kurmak için önce kayıt olup giriş yapmalısın.", "warning");
    return;
  }

  if (!playerName) {
    showWinNotification("Oyuncu hesabı bulunamadı.", "error");
    return;
  }

  if (!roomName) {
    showWinNotification("Özel oda adı yazmalısın.", "warning");
    return;
  }

  if (!password) {
    showWinNotification("Özel oda şifresi yazmalısın.", "warning");
    return;
  }

  socket.emit("createPrivateRoom", {
    roomName,
    password,
    playerName,
    customWords: privateRoomWordsInput ? privateRoomWordsInput.value : "",
    adminHidden: currentAdminStealthPreference()
  });
});

confirmPrivateJoinBtn.addEventListener("click", () => {
  const playerName = getPlayerName();
  const password = joinPrivatePassword.value.trim();

  if (!selectedPrivateRoomId) return;

  socket.emit("joinRoom", {
    roomId: selectedPrivateRoomId,
    playerName,
    password,
    adminHidden: currentAdminStealthPreference()
  });

  closeManagedModal(passwordModal);
});

cancelPrivateJoinBtn.addEventListener("click", () => {
  closeManagedModal(passwordModal);
  selectedPrivateRoomId = null;
});

socket.on("connect", () => {
  mySocketId = socket.id;
  socket.emit("getRooms");
});

socket.on("joinedRoom", ({ roomId, roomName }) => {
  currentRoomId = roomId;
  latestPlayers = [];

  lobbyScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  roomNameText.textContent = roomName;
  renderPlayers(latestPlayers);
});

// Odaya yeni bir oyuncu katıldığında özel giriş sesi odadaki herkeste çalar.
socket.on("roomPlayerJoined", () => {
  playGameSound("playerJoin", 0.92, 500);
});

function getMissingPlayerMessage(state) {
  const minimum = Math.max(0, Number(state?.minPlayersToStart || 2));
  const current = Math.max(0, Number(state?.activePlayerCount ?? state?.playerCount ?? 0));
  const missing = Math.max(0, minimum - current);
  return `Oyun için ${missing} aktif oyuncu daha lazım.`;
}

function stopWinnerCelebrationSounds() {
  if (winnerSoundStopTimer) {
    clearTimeout(winnerSoundStopTimer);
    winnerSoundStopTimer = null;
  }

  [sounds.winnerFireworks, sounds.winnerApplause].forEach((sound) => {
    if (!sound) return;
    try {
      sound.pause();
      sound.currentTime = 0;
      sound.loop = false;
    } catch (error) {}
  });
}

function startWinnerCelebrationSounds(durationMs = 15000) {
  stopWinnerCelebrationSounds();

  if (isTouchAudioDevice && !soundUnlocked) return;

  const celebrationSounds = [
    { sound: sounds.winnerFireworks, volume: 0.88 },
    { sound: sounds.winnerApplause, volume: 0.92 }
  ];

  celebrationSounds.forEach(({ sound, volume }) => {
    if (!sound) return;
    try {
      sound.pause();
      sound.currentTime = 0;
      sound.loop = false;
      sound.preload = "auto";
      sound.volume = Math.max(0, Math.min(1, volume * masterVolumeScale));
      if (sound.networkState === HTMLMediaElement.NETWORK_EMPTY) sound.load();
      sound.play().catch(() => {});
    } catch (error) {}
  });

  winnerSoundStopTimer = setTimeout(() => {
    stopWinnerCelebrationSounds();
  }, durationMs);
}

function createWinnerParticles() {
  if (!winnerConfettiLayer || !winnerFireworksLayer) return;

  winnerConfettiLayer.innerHTML = "";
  winnerFireworksLayer.innerHTML = "";

  const colors = ["#ffd700", "#ff7b00", "#ff4057", "#6cecff", "#ffffff", "#ffe66d", "#9b7bff"];

  for (let i = 0; i < 100; i++) {
    const piece = document.createElement("span");
    piece.className = "winner-confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 2.8}s`;
    piece.style.animationDuration = `${4 + Math.random() * 2.8}s`;
    winnerConfettiLayer.appendChild(piece);
  }

  for (let i = 0; i < 10; i++) {
    const burst = document.createElement("span");
    burst.className = "winner-firework-burst";
    burst.style.left = `${8 + Math.random() * 84}%`;
    burst.style.top = `${8 + Math.random() * 58}%`;
    burst.style.animationDelay = `${Math.random() * 2.2}s`;
    winnerFireworksLayer.appendChild(burst);
  }
}

function hideWinnerOverlay() {
  if (winnerOverlay) {
    winnerOverlay.classList.add("hidden");
    winnerOverlay.classList.remove("show");
  }

  if (winnerOverlayTimer) {
    clearTimeout(winnerOverlayTimer);
    winnerOverlayTimer = null;
  }

  if (winnerCountdownInterval) {
    clearInterval(winnerCountdownInterval);
    winnerCountdownInterval = null;
  }

  stopWinnerCelebrationSounds();
}

function showWinnerOverlay(winner, durationMs = 15000) {
  if (!winnerOverlay || !winner) return;

  hideWinnerOverlay();
  createWinnerParticles();

  winnerNameText.textContent = winner.name || "Oyuncu";
  winnerScoreText.textContent = `${Math.max(0, Number(winner.score || 0))} PUAN`;
  winnerOverlay.classList.remove("hidden");
  winnerOverlay.classList.add("show");
  startWinnerCelebrationSounds(durationMs);

  let secondsLeft = Math.max(1, Math.ceil(durationMs / 1000));
  winnerCountdownText.textContent = `Yeni oyun ${secondsLeft} saniye içinde başlıyor...`;

  winnerCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(winnerCountdownInterval);
      winnerCountdownInterval = null;
      winnerCountdownText.textContent = "Yeni oyun başlıyor...";
      return;
    }
    winnerCountdownText.textContent = `Yeni oyun ${secondsLeft} saniye içinde başlıyor...`;
  }, 1000);

  winnerOverlayTimer = setTimeout(() => {
    hideWinnerOverlay();
  }, durationMs);
}

function setViewerStatusMessage(message, mode = "normal") {
  if (!viewerStatusText) return;
  viewerStatusText.textContent = String(message || "");
  viewerStatus.classList.toggle("waiting-needed", mode === "waiting");
  viewerStatus.classList.toggle("starting-status", mode === "starting");
}

function removeWaitingPlayerMessagesFromGameLog() {
  if (!gameMessages) return;
  gameMessages.querySelectorAll(".game-message").forEach((item) => {
    if (/^Oyun için\s+\d+\s+oyuncu daha lazım\.?$/i.test(item.textContent.trim())) {
      item.remove();
    }
  });
}

socket.on("playersUpdate", (players) => {
  latestPlayers = Array.isArray(players) ? players : [];
  renderPlayers(latestPlayers);
});

socket.on("gameState", (state) => {
  latestGameState = state;
  const adminActive = currentAuthUser && currentAuthUser.isAdmin === true && state.isAdmin === true;
  if (adminActive && typeof state.adminHidden === "boolean") {
    setAdminStealthPreference(state.adminHidden, true);
  }
  if (adminToolbar) adminToolbar.classList.toggle("hidden", !adminActive);
  if (adminCurrentWord) adminCurrentWord.textContent = `Kelime: ${adminActive ? (state.adminWord || "-") : "-"}`;
  if (adminPauseBtn) adminPauseBtn.textContent = state.adminPaused === true ? "▶ Devam Ettir" : "⏸ Durdur";
  const wasMyTurn = isMyTurn;
  const prevStatus = currentGameStatus;
  previousGameStatus = currentGameStatus;
  const drawerChanged = lastKnownDrawerId !== null && lastKnownDrawerId !== state.drawerId;
  const roundChanged = lastKnownRound !== null && lastKnownRound !== state.round;

  if (drawerChanged || roundChanged || state.status !== "playing" || state.timeLeft > 20) {
    if (drawerChanged || roundChanged || state.status !== "playing") resetStrokeAnalysis();
    timerPanicActive = false;
    stopTimerPanicSound();
    if (timerCircle) timerCircle.classList.remove("danger");
  }

  lastKnownRound = state.round;
  lastKnownDrawerId = state.drawerId;
  lastKnownTimeLeft = state.timeLeft;

  currentDrawerId = state.status === "playing" ? state.drawerId : null;
  iAmAway = state.playerAway === true;
  updateAwayHeaderButton(latestPlayers);
  isMyTurn = Boolean(mySocketId && state.status === "playing" && currentDrawerId === mySocketId);
  if (!wasMyTurn && isMyTurn) {
    playGameSound("yourTurn", 0.96, 1000);
  }
  renderPlayers();
  currentGameStatus = state.status || "waiting";
  const stateVoteActive = state.afkVoteActive === true;
  if (!stateVoteActive) {
    afkVotedByMe = false;
  }
  afkVoteActive = stateVoteActive;
  afkVoteCount = Math.max(0, Number(state.afkVoteCount || 0));
  afkVoteNeeded = Math.max(1, Number(state.afkVoteNeeded || 3));
  warningButtonVisible = state.warningButtonVisible === true;
  warningButtonEnabled = state.warningButtonEnabled === true;
  warningAlreadyUsed = state.warningAlreadyUsed === true;
  warningUsesLeft = Math.max(0, Number(state.warningUsesLeft ?? 5));
  voteActivePlayerCount = Math.max(0, Number(state.voteActivePlayerCount || 0));
  voteMinimumActivePlayers = Math.max(3, Number(state.voteMinimumActivePlayers || 3));
  voteLockedUntilRoundComplete = state.voteLockedUntilRoundComplete === true;
  const previousSkipVoteActive = skipVoteActive;
  skipVoteActive = state.skipVoteActive === true;
  skipVoteCanVote = state.skipVoteCanVote === true;
  skipVoteHasVoted = state.skipVoteHasVoted === true;
  skipVoteYesCount = Math.max(0, Number(state.skipVoteYesCount || 0));
  skipVoteNoCount = Math.max(0, Number(state.skipVoteNoCount || 0));
  skipVoteRequired = Math.max(0, Number(state.skipVoteNeeded || 0));
  skipVoteEndsAt = Math.max(0, Number(state.skipVoteEndsAt || 0));
  skipVoteFastTrack = state.skipVoteFastTrack === true;
  skipVoteIsInitiator = state.skipVoteIsInitiator === true;
  if (!skipVoteActive) {
    skipVotePanelOpened = false;
    skipVoteShouldAlert = false;
    stopSkipVoteAlertBlink();
    stopSkipVoteCountdown();
  } else if (!previousSkipVoteActive) {
    // Popup sadece başlatanda açılır; diğerlerinde çağrı ünlemi yanıp söner.
    skipVotePanelOpened = skipVoteIsInitiator;
    startSkipVoteCountdown(skipVoteEndsAt);
  }
  // V12: Sunucudan çağrı bayrağı geldiyse alarmı istemcide kilitle.
  // Sonraki gameState paketleri bu alarmı yanlışlıkla söndüremez.
  const serverWantsVoteAlert =
    skipVoteActive &&
    state.skipVoteShouldAlert === true &&
    !skipVotePanelOpened &&
    !skipVoteHasVoted &&
    !skipVoteIsInitiator;
  if (serverWantsVoteAlert) {
    skipVoteShouldAlert = true;
    startSkipVoteAlertBlink();
  } else if (!skipVoteActive || skipVotePanelOpened || skipVoteHasVoted || isMyTurn) {
    skipVoteShouldAlert = false;
    stopSkipVoteAlertBlink();
  }
  earHintActive = state.earHintActive === true;
  currentHintActive = state.hasHint === true;
  currentMaskedWord = typeof state.maskedWord === "string" ? state.maskedWord : "";
  canFinishTurn = state.canFinishTurn === true;
  skipAvailable = state.skipAvailable !== false;

  roomNameText.textContent = state.roomName;
  roundText.textContent = state.round;
  totalRoundText.textContent = state.totalRounds;
  drawerText.textContent = state.status === "starting"
    ? "Oyun başlıyor..."
    : (state.drawerName || "Bekleniyor");
  userCountText.textContent = state.playerCount;

  if (state.adminPaused === true) {
    setViewerStatusMessage("Oyun SFD SKETCH tarafından durduruldu.", "starting");
  } else if (state.status === "waiting") {
    hideWinnerOverlay();
    setViewerStatusMessage(getMissingPlayerMessage(state), "waiting");
    removeWaitingPlayerMessagesFromGameLog();
  } else if (state.status === "starting") {
    hideWinnerOverlay();
    setViewerStatusMessage("Oyun başlıyor...", "starting");
    removeWaitingPlayerMessagesFromGameLog();
  } else if (state.status === "intermission") {
    hideWinnerOverlay();
    setViewerStatusMessage("Doğru cevap gösteriliyor...", "starting");
  } else if (state.status === "gameover") {
    setViewerStatusMessage("Kazanan oyuncu gösteriliyor...", "starting");
  } else {
    hideWinnerOverlay();
    setViewerStatusMessage("Çizim sırası sende değil. Sadece izliyorsun.", "normal");
  }

  if (state.status === "starting") {
    timerCircle.textContent = state.countdownLeft || 0;
    timerCircle.classList.add("countdown");
  } else if (state.status === "intermission") {
    timerCircle.textContent = state.intermissionLeft || 0;
    timerCircle.classList.add("countdown");
  } else {
    timerCircle.textContent = state.timeLeft;
    timerCircle.classList.remove("countdown");
  }

  hintAvailable = state.hintAvailable !== false;

  const timerShouldBeDanger =
    state.status === "playing" &&
    (
      state.timeLeft <= 15 ||
      (timerPanicActive && state.timeLeft <= 20)
    );

  if (timerShouldBeDanger) {
    timerCircle.classList.add("danger");
  } else {
    timerCircle.classList.remove("danger");
  }

  if (state.status === "waiting" || state.status === "starting" || state.status === "gameover") {
    currentSecretWord = "";
    currentMaskedWord = "";
    currentHintActive = false;
    if (wordLine) wordLine.classList.add("hidden");
    wordText.innerHTML = "";
    wordText.classList.remove("hex-word-wrap");
  } else if (state.status === "intermission") {
    if (wordLabel) wordLabel.textContent = "Doğru cevap:";
    if (wordLine) wordLine.classList.remove("hidden");
    wordText.textContent = state.correctWord || "";
  } else {
    updatePlayingWordLine();
  }

  updateDrawerSecretWord();
  updateTurnButtons();
  updateAfkVoteButton();
  updateEarHintIndicator();
  updateIntermissionOverlay(state);
  updateSkipVoteOverlay();
  updateTimerPanicSound(state);

  if (prevStatus !== "playing" && state.status === "playing" && !isMyTurn && !iHaveGuessed && !iAmAway) {
    activeMessageMode = "guess";
    setTimeout(() => {
      if (currentGameStatus === "playing" && !isMyTurn && !iHaveGuessed && !iAmAway) {
        setMessageTarget("guess", true);
      }
    }, 30);
  }
});

socket.on("secretWord", (word) => {
  currentSecretWord = word || "";
  updatePlayingWordLine();
  updateDrawerSecretWord();
});

function updatePlayingWordLine() {
  if (!wordLine || !wordText) return;

  wordText.innerHTML = "";
  wordText.classList.remove("hex-word-wrap", "hex-word-small");

  if (currentGameStatus !== "playing") return;

  // Sol üstteki alan çizen oyuncunun HINT görünümüdür.
  // Gerçek kelime çizim alanının üst-orta bölümünde ayrıca gösterilir.
  if (!isMyTurn) {
    wordLine.classList.add("hidden");
    return;
  }

  if (wordLabel) wordLabel.textContent = "İpucu:";
  wordLine.classList.remove("hidden");

  // Çizen oyuncu ilk HINT'e basana kadar ipucu altıgenleri görünmez.
  // İlk basışta yalnızca boş altıgenler (harf sayısı), sonraki basışlarda açılan harfler görünür.
  if (currentHintActive && currentMaskedWord) {
    renderHexWord(wordText, currentMaskedWord, { small: true, hiddenAsBlank: true });
  }
}


function renderHexWord(container, word, options = {}) {
  if (!container) return;

  const small = Boolean(options.small);
  const hiddenAsBlank = options.hiddenAsBlank !== false;
  const raw = String(word || "").trim();

  container.innerHTML = "";
  container.classList.add("hex-word-wrap");
  container.classList.toggle("hex-word-small", small);

  if (!raw) return;

  [...raw].forEach((token) => {
    if (token === " ") {
      const gap = document.createElement("span");
      gap.className = "hex-word-gap";
      gap.setAttribute("aria-label", "kelime arası");
      container.appendChild(gap);
      return;
    }

    const cell = document.createElement("span");
    cell.className = "hex-cell";

    const letter = document.createElement("span");
    letter.className = "hex-letter";

    if (token === "_" && hiddenAsBlank) {
      letter.textContent = "";
      cell.classList.add("hex-hidden");
    } else {
      letter.textContent = token;
    }

    cell.appendChild(letter);
    container.appendChild(cell);
  });
}

function appendSecretWordLabel(container, text) {
  const label = document.createElement("div");
  label.className = "secret-word-label";
  label.textContent = text;
  container.appendChild(label);
}

function appendSecretWordHexLabel(container, text) {
  const labelWrap = document.createElement("div");
  labelWrap.className = "secret-word-label-hex";
  renderHexWord(labelWrap, text, { small: true, hiddenAsBlank: false });
  container.appendChild(labelWrap);
}

function updateDrawerSecretWord() {
  if (!drawerSecretWord) return;

  drawerSecretWord.innerHTML = "";

  if (currentGameStatus !== "playing") {
    drawerSecretWord.classList.add("hidden");
    return;
  }

  // Çizen oyuncunun gerçek kelimesi üst-orta alanda kırmızı altıgenlerle gösterilir.
  if (isMyTurn) {
    const stack = document.createElement("div");
    stack.className = "secret-word-stack";
    appendSecretWordHexLabel(stack, "KELİME");

    const hexWrap = document.createElement("div");
    stack.appendChild(hexWrap);
    renderHexWord(hexWrap, currentSecretWord, { small: false, hiddenAsBlank: false });

    drawerSecretWord.appendChild(stack);
    drawerSecretWord.classList.remove("hidden");
    return;
  }

  if (!isMyTurn) {
    const stack = document.createElement("div");
    stack.className = "secret-word-stack";
    appendSecretWordHexLabel(stack, "İPUCU");
    const hexWrap = document.createElement("div");
    stack.appendChild(hexWrap);

    if (currentHintActive && currentMaskedWord && currentMaskedWord.trim() !== "") {
      renderHexWord(hexWrap, currentMaskedWord, { small: false, hiddenAsBlank: true });
    } else {
      hexWrap.className = "hex-word-wrap";
    }

    drawerSecretWord.appendChild(stack);
    drawerSecretWord.classList.remove("hidden");
    return;
  }

  drawerSecretWord.classList.add("hidden");
}




const EMOJI_CATEGORIES = [
  {
    id: "recent",
    icon: "🕘",
    title: "Son Kullanılan",
    keywords: "son kullanılan recent",
    emojis: []
  },
  {
    id: "smileys",
    icon: "😊",
    title: "Yüzler",
    keywords: "yüz smile mutlu gül komik ağla kızgın şaşır",
    emojis: [
      "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
      "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️",
      "😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓",
      "🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵",
      "🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👻","💀","☠️","👽","🤖","💩","😺","😸"
    ]
  },
  {
    id: "hands",
    icon: "👍",
    title: "El / İnsan",
    keywords: "el insan tamam alkış kalp dua",
    emojis: [
      "👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍",
      "👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","👂","👃","🧠","👀","👁️",
      "👅","👄","👶","🧒","👦","👧","🧑","👨","👩","🧓","👴","👵","🙍","🙎","🙅","🙆","💁","🙋","🙇","🤦","🤷"
    ]
  },
  {
    id: "hearts",
    icon: "❤️",
    title: "Kalpler",
    keywords: "kalp aşk sevgi duygu",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️",
      "💯","💢","💥","💫","💦","💨","💣","💬","🗨️","🗯️","💭","💤","🔥","✨","🌟","⭐","⚡","☄️"
    ]
  },
  {
    id: "animals",
    icon: "🐶",
    title: "Hayvan",
    keywords: "hayvan kedi köpek kuş balık",
    emojis: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒",
      "🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜",
      "🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊",
      "🐅","🐆","🦓","🦍","🐘","🦛","🦏","🐪","🐫","🦒","🦘"
    ]
  },
  {
    id: "food",
    icon: "🍔",
    title: "Yemek",
    keywords: "yemek içecek meyve tatlı",
    emojis: [
      "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑",
      "🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🥞","🥓","🥩",
      "🍗","🍖","🌭","🍔","🍟","🍕","🥪","🥙","🌮","🌯","🥗","🥘","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🍤",
      "🍙","🍚","🍘","🍥","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪",
      "☕","🍵","🧃"
    ]
  },
  {
    id: "activity",
    icon: "⚽",
    title: "Aktivite",
    keywords: "oyun spor eğlence",
    emojis: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🏓","🏸","🏒","🏑","🏏","⛳","🎣","🥊","🥋","🛹",
      "⛸️","🎿","⛷️","🏂","🏋️","🤼","🤸","⛹️","🤺","🏇","🧘","🏄","🏊","🚴","🏆","🥇","🥈","🥉","🏅","🎖️",
      "🎫","🎟️","🎪","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻","🎲","♟️","🎯","🎳","🎮","🧩"
    ]
  },
  {
    id: "travel",
    icon: "🚗",
    title: "Araç",
    keywords: "araç yolculuk araba uçak ev",
    emojis: [
      "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️","🛵","🚲","🛴","🚨","🚔",
      "🚍","🚘","🚖","🚡","🚠","🚃","🚋","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🚀","🚁",
      "⛵","🚤","🚢","⚓","⛽","🚧","🚦","🗺️","🗿","🗽","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲","🏖️","🏝️",
      "🌋","⛰️","🗻","🏕️","⛺","🏠","🏡","🏘️","🏢","🏬","🏥","🏦","🏨","🏪","🏫"
    ]
  },
  {
    id: "objects",
    icon: "💡",
    title: "Nesne",
    keywords: "nesne eşya teknoloji araç gereç",
    emojis: [
      "⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","🕹️","💽","💾","💿","📷","📸","📹","🎥","📞","☎️","📺","📻","🎙️",
      "⏰","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯️","🧯","💸","💵","💴","💶","💷","💰","💳","💎","⚖️","🧰",
      "🔧","🔨","⚒️","🛠️","⛏️","🔩","⚙️","🧲","💣","🔪","🛡️","🔮","🧿","🔭","🔬","🩹","🩺","💊","💉","🧬"
    ]
  },
  {
    id: "symbols",
    icon: "🔣",
    title: "Sembol",
    keywords: "sembol işaret",
    emojis: [
      "✅","☑️","✔️","❌","❎","➕","➖","➗","✖️","♾️","‼️","⁉️","❓","❔","❕","❗","⭕","🟢","🔵","🟣",
      "🔴","🟠","🟡","⚫","⚪","🟤","⬛","⬜","◼️","◻️","🔶","🔷","🔸","🔹","🔺","🔻","💠","🔘","🏁","🚩","🇹🇷"
    ]
  }
];

let activeEmojiCategory = "smileys";

function getRecentEmojis() {
  try {
    return JSON.parse(localStorage.getItem("sfd_recent_emojis") || "[]").filter(Boolean).slice(0, 24);
  } catch (error) {
    return [];
  }
}

function saveRecentEmoji(emoji) {
  try {
    const current = getRecentEmojis().filter((item) => item !== emoji);
    current.unshift(emoji);
    localStorage.setItem("sfd_recent_emojis", JSON.stringify(current.slice(0, 24)));
  } catch (error) {}
}

function allEmojiSearchItems() {
  return EMOJI_CATEGORIES
    .filter((cat) => cat.id !== "recent")
    .flatMap((cat) => cat.emojis.map((emoji) => ({
      emoji,
      keywords: `${cat.title} ${cat.keywords || ""}`
    })));
}

function renderChatEmojiPicker() {
  if (!chatEmojiPicker || !emojiCategoryTabs || !emojiGrid) return;

  const recent = getRecentEmojis();
  const recentCategory = EMOJI_CATEGORIES.find((cat) => cat.id === "recent");
  if (recentCategory) recentCategory.emojis = recent;

  emojiCategoryTabs.innerHTML = "";
  EMOJI_CATEGORIES.forEach((cat) => {
    if (cat.id === "recent" && !cat.emojis.length) return;

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "emoji-category-tab";
    tab.dataset.category = cat.id;
    tab.textContent = cat.icon;
    tab.title = cat.title;
    tab.classList.toggle("active", cat.id === activeEmojiCategory);
    tab.addEventListener("click", () => {
      activeEmojiCategory = cat.id;
  
      renderEmojiGrid();
    });
    emojiCategoryTabs.appendChild(tab);
  });

  renderEmojiGrid();
}

function renderRecentRow() {
  if (!emojiRecentRow) return;
  const recent = getRecentEmojis();
  emojiRecentRow.innerHTML = "";

  if (!recent.length || activeEmojiCategory === "recent") {
    emojiRecentRow.classList.add("hidden");
    return;
  }

  emojiRecentRow.classList.remove("hidden");

  recent.slice(0, 12).forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-recent-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => selectChatEmoji(emoji));
    emojiRecentRow.appendChild(btn);
  });
}

function renderEmojiGrid() {
  if (!emojiGrid) return;

  const query = emojiSearchInput ? emojiSearchInput.value.trim().toLowerCase() : "";
  let items;

  if (query) {
    items = allEmojiSearchItems().filter((item) => {
      return item.emoji.includes(query) || item.keywords.toLowerCase().includes(query);
    }).map((item) => item.emoji);
  } else {
    const category = EMOJI_CATEGORIES.find((cat) => cat.id === activeEmojiCategory) || EMOJI_CATEGORIES[1];
    items = category.emojis || [];
    if (activeEmojiCategory === "recent" && !items.length) {
      activeEmojiCategory = "smileys";
      items = EMOJI_CATEGORIES.find((cat) => cat.id === "smileys").emojis;
    }
  }

  emojiGrid.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "emoji-empty";
    empty.textContent = "Emoji bulunamadı.";
    emojiGrid.appendChild(empty);
    renderRecentRow();
    updateEmojiCategoryTabs();
    return;
  }

  items.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-item-btn";
    btn.textContent = emoji;
    btn.title = emoji;
    btn.addEventListener("click", () => selectChatEmoji(emoji));
    emojiGrid.appendChild(btn);
  });

  renderRecentRow();
  updateEmojiCategoryTabs();
}

function updateEmojiCategoryTabs() {
  if (!emojiCategoryTabs) return;
  emojiCategoryTabs.querySelectorAll(".emoji-category-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.category === activeEmojiCategory);
  });
}

function selectChatEmoji(emoji) {
  if (!canUseChatEmoji()) return;

  // V60: Emoji ortak Tahmin kutusuna yazılmaz. Dokunulduğu anda doğrudan
  // normal Chat kanalına gider; böylece yanlışlıkla tahmin olarak gönderilemez.
  activeMessageMode = "chat";
  setMessageTarget("chat", false);
  if (typeof window.sfdSelectMobilePanel === "function") {
    window.sfdSelectMobilePanel("chat", { scrollToEnd: true });
  }
  socket.emit("normalChat", String(emoji || ""));
  saveRecentEmoji(emoji);
  renderChatEmojiPicker();
}

function insertEmojiToMainInput(emoji) {
  if (!mainMessageInput) return;
  const start = mainMessageInput.selectionStart ?? mainMessageInput.value.length;
  const end = mainMessageInput.selectionEnd ?? mainMessageInput.value.length;
  const value = mainMessageInput.value || "";
  mainMessageInput.value = value.slice(0, start) + emoji + value.slice(end);
  const pos = start + emoji.length;
  mainMessageInput.focus();
  try {
    mainMessageInput.setSelectionRange(pos, pos);
  } catch (err) {}
}

function canUseChatEmoji() {
  if (!chatEmojiBtn) return false;
  if (isMyTurn) return false;
  return currentGameStatus === "waiting" ||
    currentGameStatus === "starting" ||
    currentGameStatus === "playing";
}

function updateChatEmojiState() {
  if (!chatEmojiBtn) return;
  const enabled = canUseChatEmoji();
  chatEmojiBtn.disabled = !enabled;
  chatEmojiBtn.classList.toggle("disabled", !enabled);
  chatEmojiBtn.title = enabled
    ? "Chat emojileri — açınca otomatik olarak sohbet moduna geçer"
    : "Bu sırada emoji kullanılamaz";
  if (!enabled) closeChatEmojiPicker();
}

function closeChatEmojiPicker() {
  if (!chatEmojiPicker) return;
  chatEmojiPicker.classList.add("hidden");
  if (chatEmojiBtn) chatEmojiBtn.classList.remove("open");
}

function toggleChatEmojiPicker() {
  if (!chatEmojiPicker || !chatEmojiBtn || !canUseChatEmoji()) return;
  const willOpen = chatEmojiPicker.classList.contains("hidden");
  closeChatEmojiPicker();
  if (willOpen) {
    activeMessageMode = "chat";
    setMessageTarget("chat", false);
    renderChatEmojiPicker();
    chatEmojiPicker.classList.remove("hidden");
    chatEmojiBtn.classList.add("open");

  }
}


function normalizeWhisperTarget(value) {
  return String(value || "").trim().slice(0, 18);
}

function applyWhisperComposerOverride() {
  if (!whisperModeActive) return;
  if (whisperTargetBox) whisperTargetBox.classList.remove("hidden");
  if (messageComposerShell) messageComposerShell.classList.add("whisper-active");
  mainMessageInput.disabled = false;
  if (sendMainMessageBtn) sendMainMessageBtn.disabled = false;
  mainMessageInput.placeholder = whisperTargetUsername
    ? "Fısıltı mesajını yaz..."
    : "Önce Kime alanına oyuncu adını yaz...";
}

function setWhisperTarget(username, focusMessage = true) {
  const cleanTarget = normalizeWhisperTarget(username);
  whisperModeActive = true;
  whisperTargetUsername = cleanTarget;
  if (cleanTarget) lastWhisperTargetUsername = cleanTarget;
  if (whisperTargetBox) whisperTargetBox.classList.remove("hidden");
  if (whisperTargetInput) whisperTargetInput.value = cleanTarget;
  closeChatEmojiPicker();
  applyWhisperComposerOverride();

  if (cleanTarget && focusMessage) {
    mainMessageInput.focus();
  } else if (whisperTargetInput) {
    whisperTargetInput.focus();
    whisperTargetInput.select();
  }
}

function openWhisperTargetChooser(prefill = "") {
  const initial = normalizeWhisperTarget(prefill || whisperTargetUsername || lastWhisperTargetUsername);
  setWhisperTarget(initial, Boolean(initial));
}

function closeWhisperMode() {
  const closingTarget = normalizeWhisperTarget(whisperTargetInput ? whisperTargetInput.value : whisperTargetUsername);
  if (closingTarget) lastWhisperTargetUsername = closingTarget;
  whisperModeActive = false;
  whisperTargetUsername = "";
  if (whisperTargetInput) whisperTargetInput.value = "";
  if (whisperTargetBox) whisperTargetBox.classList.add("hidden");
  if (messageComposerShell) messageComposerShell.classList.remove("whisper-active");
  updateTurnButtons();
}

function confirmWhisperTarget() {
  const cleanTarget = normalizeWhisperTarget(whisperTargetInput ? whisperTargetInput.value : "");
  if (!cleanTarget) {
    showWinNotification("Fısıltı göndereceğin oyuncu adını yazmalısın.", "warning");
    whisperTargetInput?.focus();
    return false;
  }
  if (currentAuthUser && cleanTarget.toLowerCase() === String(currentAuthUser.username || "").toLowerCase()) {
    showWinNotification("Kendine fısıltı gönderemezsin.", "warning");
    whisperTargetInput?.focus();
    return false;
  }
  whisperTargetUsername = cleanTarget;
  lastWhisperTargetUsername = cleanTarget;
  if (whisperTargetInput) whisperTargetInput.value = cleanTarget;
  applyWhisperComposerOverride();
  mainMessageInput.focus();
  return true;
}

function addWhisperMessage(payload = {}) {
  if (!chatMessages) return;
  const direction = payload.direction === "outgoing" ? "outgoing" : "incoming";
  const from = String(payload.from || "").trim();
  const to = String(payload.to || "").trim();
  const message = String(payload.message || "").trim();
  if (!message) return;

  const div = document.createElement("div");
  div.className = `whisper-message ${direction}`;
  const routeText = direction === "outgoing"
    ? `Senden → ${escapeHtml(to)}`
    : `${escapeHtml(from)} → Sana`;
  div.innerHTML = `<span class="whisper-message-label">Fısıltı • ${routeText}</span><span class="whisper-message-text">${escapeHtml(message)}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setMessageTarget(mode, shouldFocus = false) {
  if (mode !== "guess" && mode !== "chat") return;
  if (iAmAway && mode === "guess") mode = "chat";

  activeMessageMode = mode;

  if (mode === "guess") {
    gameMessages.classList.add("active-target");
    chatMessages.classList.remove("active-target");
    mainMessageInput.placeholder = "Tahmin yaz...";
  } else {
    chatMessages.classList.add("active-target");
    gameMessages.classList.remove("active-target");
    mainMessageInput.placeholder = "Sohbet yaz...";
  }

  if (shouldFocus) {
    mainMessageInput.focus();
  }

  updateChatEmojiState();
}

function applyMessageTargetAfterState() {
  if (isMyTurn) {
    chatMessages.classList.remove("active-target");
    gameMessages.classList.remove("active-target");
    activeMessageMode = null;
    return;
  }

  if (iAmAway) {
    chatMessages.classList.add("active-target");
    gameMessages.classList.remove("active-target");
    gameMessages.classList.remove("guessed-locked");
    gameMessages.classList.add("away-locked");
    activeMessageMode = "chat";
    mainMessageInput.placeholder = "AWAY modundasın — yalnızca Chat yazabilirsin.";
    return;
  }

  gameMessages.classList.remove("away-locked");

  if (iHaveGuessed) {
    chatMessages.classList.add("active-target");
    gameMessages.classList.add("guessed-locked");
    gameMessages.classList.remove("active-target");
    activeMessageMode = "chat";
    return;
  }

  gameMessages.classList.remove("guessed-locked");

  if (!activeMessageMode) {
    activeMessageMode = "guess";
  }

  setMessageTarget(activeMessageMode, false);
}



function scheduleAfkVoteCooldownRefresh() {
  if (afkVoteCooldownTimer) {
    clearTimeout(afkVoteCooldownTimer);
    afkVoteCooldownTimer = null;
  }

  const remaining = afkVoteCooldownUntil - Date.now();
  if (remaining > 0) {
    afkVoteCooldownTimer = setTimeout(() => {
      afkVoteCooldownTimer = null;
      updateAfkVoteButton();
    }, remaining + 30);
  }
}

function stopSkipVoteAlertBlink() {
  skipVoteAlertLocked = false;
  skipVoteAlertBlinkOn = false;
  if (skipVoteAlertBlinkTimer) {
    clearInterval(skipVoteAlertBlinkTimer);
    skipVoteAlertBlinkTimer = null;
  }
  if (afkVoteBtn) {
    afkVoteBtn.classList.remove("vote-alert-red");
    afkVoteBtn.classList.remove("vote-attention");
  }
  setAfkVoteAlertIcon(false);
}

function startSkipVoteAlertBlink() {
  if (!afkVoteBtn || isMyTurn || skipVotePanelOpened || skipVoteHasVoted) return;
  skipVoteAlertLocked = true;
  skipVoteShouldAlert = true;

  if (!skipVoteAlertBlinkTimer) {
    skipVoteAlertBlinkOn = true;
    afkVoteBtn.classList.add("vote-alert-red");
    setAfkVoteAlertIcon(true);
    skipVoteAlertBlinkTimer = setInterval(() => {
      if (!skipVoteAlertLocked || !skipVoteActive || skipVotePanelOpened || skipVoteHasVoted || isMyTurn) {
        stopSkipVoteAlertBlink();
        return;
      }
      skipVoteAlertBlinkOn = !skipVoteAlertBlinkOn;
      afkVoteBtn.classList.toggle("vote-alert-red", skipVoteAlertBlinkOn);
      setAfkVoteAlertIcon(skipVoteAlertBlinkOn);
    }, 430);
  }
}

function updateAfkVoteButton() {
  if (!afkVoteBtn) return;
  const shouldShow = currentGameStatus === "playing" && !isMyTurn && warningButtonVisible;
  const voteWaitingForMe =
    skipVoteActive &&
    !skipVoteHasVoted &&
    !skipVotePanelOpened &&
    (skipVoteAlertLocked || skipVoteShouldAlert || (!skipVoteIsInitiator && skipVoteCanVote));

  afkVoteBtn.classList.toggle("hidden", !shouldShow);
  afkVoteBtn.classList.toggle("voted", skipVoteActive ? skipVoteHasVoted : warningAlreadyUsed);
  afkVoteBtn.classList.toggle("vote-attention", shouldShow && voteWaitingForMe);
  if (!shouldShow || !voteWaitingForMe) {
    afkVoteBtn.classList.remove("vote-alert-red");
    setAfkVoteAlertIcon(false);
  } else if (skipVoteAlertLocked && skipVoteAlertBlinkOn) {
    afkVoteBtn.classList.add("vote-alert-red");
    setAfkVoteAlertIcon(true);
  } else if (shouldShow && voteWaitingForMe) {
    setAfkVoteAlertIcon(false);
  }
  afkVoteBtn.classList.remove("suspicious-flash");
  afkVoteBtn.classList.toggle("locked", shouldShow && !warningButtonEnabled && !skipVoteActive);

  // Aktif oylamada ünlem, oy verilmiş olsa bile sonuç ekranını yeniden açabilsin.
  afkVoteBtn.disabled = !shouldShow || (!skipVoteActive && (!warningButtonEnabled || warningAlreadyUsed));

  if (skipVoteActive) {
    afkVoteBtn.title = skipVoteHasVoted
      ? "Oylama sonucunu görmek için tıkla"
      : "Turu Atlat oylamasına katılmak için tıkla";
  } else {
    afkVoteBtn.title = warningAlreadyUsed
      ? "Bu raundda vote hakkını kullandın; sonraki raundu bekle"
      : (warningButtonEnabled
        ? `Çizeni oylamaya aç — 10 raundluk oyunda ${warningUsesLeft}/5 hakkın kaldı; raund başına 1 kez`
        : (warningUsesLeft <= 0
          ? "Bu oyun için oylama başlatma hakkın kalmadı"
          : (voteLockedUntilRoundComplete
            ? "Vote kullanmak için AWAY sonrası 1 round tamamlamalısın"
            : (voteActivePlayerCount < voteMinimumActivePlayers
              ? `Vote için AWAY olmayan en az ${voteMinimumActivePlayers} aktif oyuncu gerekli`
              : "Şu anda oylama başlatılamaz"))));
  }
}

function updateEarHintIndicator() {
  if (!earHintIndicator) return;
  const show = currentGameStatus === "playing" && !isMyTurn && earHintActive;
  earHintIndicator.classList.toggle("hidden", !show);
  if (earHintBtn) {
    earHintBtn.disabled = earHintActive;
    earHintBtn.classList.toggle("active", earHintActive);
  }
}

function updateIntermissionOverlay(state = latestGameState || {}) {
  if (!intermissionOverlay) return;
  const show = state.status === "intermission";
  intermissionOverlay.classList.toggle("hidden", !show);
  if (show) {
    if (intermissionWord) intermissionWord.textContent = state.correctWord || "-";
    if (intermissionCountdown) intermissionCountdown.textContent = `Sıradaki çizime ${state.intermissionLeft || 0} saniye...`;
  }
}

function getSkipVoteSecondsLeft() {
  if (!skipVoteActive || !skipVoteEndsAt) return 0;
  return Math.max(0, Math.ceil((skipVoteEndsAt - Date.now()) / 1000));
}

function stopSkipVoteCountdown() {
  if (skipVoteCountdownTimer) {
    clearInterval(skipVoteCountdownTimer);
    skipVoteCountdownTimer = null;
  }
}

function startSkipVoteCountdown(endsAt) {
  skipVoteEndsAt = Math.max(0, Number(endsAt || skipVoteEndsAt || 0));
  stopSkipVoteCountdown();
  if (!skipVoteActive || !skipVoteEndsAt) return;
  skipVoteCountdownTimer = setInterval(() => {
    updateSkipVoteOverlay();
    if (!skipVoteActive || getSkipVoteSecondsLeft() <= 0) stopSkipVoteCountdown();
  }, 250);
}

function updateSkipVoteOverlay() {
  if (!skipVoteOverlay) return;
  const shouldShow = skipVoteActive && !isMyTurn && skipVotePanelOpened;
  skipVoteOverlay.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    skipVoteOverlay.classList.remove("minimized");
  }

  const secondsLeft = getSkipVoteSecondsLeft();
  const fastTrackText = skipVoteFastTrack ? " · TEK EVET YETERLİ" : "";
  if (skipVoteProgress) {
    skipVoteProgress.textContent = `${skipVoteYesCount} / ${skipVoteRequired} evet · ${skipVoteNoCount} hayır · ${secondsLeft} sn${fastTrackText}`;
  }
  if (skipVoteYesBtn) skipVoteYesBtn.disabled = !skipVoteCanVote || skipVoteHasVoted;
  if (skipVoteNoBtn) skipVoteNoBtn.disabled = !skipVoteCanVote || skipVoteHasVoted;
  if (skipVoteLockedText) {
    const showLocked = skipVoteHasVoted || !skipVoteCanVote;
    skipVoteLockedText.classList.toggle("hidden", !showLocked);
    if (showLocked) {
      skipVoteLockedText.textContent = skipVoteHasVoted
        ? "Oyun kaydedildi. Oylama sonucunu bekliyorsun."
        : "Bu oylamada oy kullanamazsın.";
    }
  }
}

socket.on("gameFinished", ({ winner, durationMs }) => {
  timerPanicActive = false;
  stopTimerPanicSound();
  showWinnerOverlay(winner, durationMs || 15000);
});

function resetLocalAfkVote() {
  afkVoteActive = false;
  afkVoteCount = 0;
  afkVoteNeeded = 3;
  afkVotedByMe = false;
  afkVoteSubmitting = false;
  afkVoteCooldownUntil = 0;
  if (afkVoteCooldownTimer) {
    clearTimeout(afkVoteCooldownTimer);
    afkVoteCooldownTimer = null;
  }
  updateAfkVoteButton();
}

function applyRightColumnMode(mode) {
  const rightColumn = document.querySelector(".right-column");
  document.body.classList.remove("viewer-mode", "drawer-mode", "waiting-mode", "starting-mode");
  if (rightColumn) {
    rightColumn.classList.remove("viewer-mode", "drawer-mode", "waiting-mode", "starting-mode");
  }

  if (!mode) return;

  document.body.classList.add(mode);
  if (rightColumn) {
    rightColumn.classList.add(mode);
  }
}

function updateSkipDoneButton() {
  if (skipBtn) {
    if (canFinishTurn) {
      skipBtn.textContent = "DONE";
      skipBtn.title = "Doğru tahmin geldi; çizim turunu bitir";
      skipBtn.classList.remove("danger", "disabled");
      skipBtn.classList.add("done-state");
      skipBtn.disabled = false;
    } else {
      skipBtn.textContent = "SKIP";
      skipBtn.title = "Bu çizimi atla; çizen bu turdan 0 puan alır";
      skipBtn.classList.remove("done-state");
      skipBtn.classList.add("danger");
      skipBtn.disabled = !skipAvailable;
      skipBtn.classList.toggle("disabled", !skipAvailable);
    }
  }

  // Ayrı DONE düğmesi kullanılmıyor; SKIP düğmesi doğru tahminde DONE'a dönüşür.
  if (doneBtn) {
    doneBtn.classList.add("hidden");
    doneBtn.disabled = true;
  }
}

function updateTurnButtons() {
  document.body?.classList.toggle(
    "sfd-player-guessed",
    currentGameStatus === "playing" && iHaveGuessed && !isMyTurn
  );
  updateSkipDoneButton();

  if (currentGameStatus === "starting" || currentGameStatus === "waiting" || currentGameStatus === "intermission" || currentGameStatus === "gameover") {
    applyRightColumnMode(currentGameStatus === "waiting" ? "waiting-mode" : "starting-mode");
    hintBtn.classList.add("hidden");
    hintBtn.disabled = true;
    hintBtn.classList.add("disabled");
    skipBtn.classList.add("hidden");
    if (doneBtn) doneBtn.classList.add("hidden");
    clearBtn.classList.add("hidden");
    if (earHintBtn) earHintBtn.classList.add("hidden");
    drawToolsBar.classList.add("hidden");
    viewerStatus.classList.remove("hidden");
    canvas.classList.add("disabled");

    if (chatPanel) chatPanel.classList.remove("hidden");

    // Oyun başlamamışken tahmin kapalı, alttaki Chat açık kalsın.
    activeMessageMode = "chat";
    chatMessages.classList.add("active-target");
    gameMessages.classList.remove("active-target");
    gameMessages.classList.remove("guessed-locked");

    mainMessageInput.disabled = false;
    sendMainMessageBtn.disabled = false;
    mainMessageInput.placeholder = currentGameStatus === "gameover"
      ? "Kazanan ekranı gösteriliyor..."
      : (currentGameStatus === "intermission"
        ? "Doğru cevap gösteriliyor..."
        : (currentGameStatus === "starting"
        ? "Oyun başlıyor... Bu sırada sohbet yazabilirsin."
        : "Oyun bekleniyor... Sohbet yazabilirsin."));
    updateChatEmojiState();
    applyWhisperComposerOverride();
    return;
  }

  if (isMyTurn) {
    applyRightColumnMode("drawer-mode");
    hintBtn.classList.remove("hidden");
    hintBtn.disabled = !hintAvailable;
    hintBtn.classList.toggle("disabled", !hintAvailable);
    skipBtn.classList.remove("hidden");
    if (doneBtn) doneBtn.classList.add("hidden");
    clearBtn.classList.remove("hidden");
    if (earHintBtn) earHintBtn.classList.remove("hidden");
    drawToolsBar.classList.remove("hidden");
    viewerStatus.classList.add("hidden");
    canvas.classList.remove("disabled");

    // Normal çizen mesaj yazamaz; SFD SKETCH yöneticisi çizim sırasında da duyuru/chat yazabilir.
    if (chatPanel) chatPanel.classList.remove("hidden");
    gameMessages.classList.remove("active-target");
    gameMessages.classList.remove("guessed-locked");
    const adminCanChatWhileDrawing = currentAuthUser && currentAuthUser.isAdmin === true;
    if (adminCanChatWhileDrawing) {
      chatMessages.classList.add("active-target");
      activeMessageMode = "chat";
      mainMessageInput.disabled = false;
      sendMainMessageBtn.disabled = false;
      mainMessageInput.placeholder = "SFD SKETCH yönetici mesajı yaz...";
    } else {
      chatMessages.classList.remove("active-target");
      activeMessageMode = null;
      mainMessageInput.disabled = true;
      sendMainMessageBtn.disabled = true;
      mainMessageInput.placeholder = "Çizim sırası sende. Çizen oyuncu mesaj yazamaz.";
    }
    updateChatEmojiState();
  } else {
    applyRightColumnMode("viewer-mode");
    currentSecretWord = "";
    updateDrawerSecretWord();
    hintBtn.classList.add("hidden");
    hintBtn.disabled = true;
    hintBtn.classList.add("disabled");
    skipBtn.classList.add("hidden");
    if (doneBtn) doneBtn.classList.add("hidden");
    clearBtn.classList.add("hidden");
    if (earHintBtn) earHintBtn.classList.add("hidden");
    drawToolsBar.classList.add("hidden");
    viewerStatus.classList.remove("hidden");
    canvas.classList.add("disabled");

    if (chatPanel) chatPanel.classList.remove("hidden");

    if (iAmAway) {
      gameMessages.classList.remove("active-target", "guessed-locked");
      gameMessages.classList.add("away-locked");
      chatMessages.classList.add("active-target");
      activeMessageMode = "chat";
      mainMessageInput.disabled = false;
      sendMainMessageBtn.disabled = false;
      mainMessageInput.placeholder = "AWAY modundasın — yalnızca Chat yazabilirsin.";
      updateChatEmojiState();
    } else if (iHaveGuessed) {
      gameMessages.classList.remove("active-target", "away-locked");
      gameMessages.classList.add("guessed-locked");
      chatMessages.classList.add("active-target");
      activeMessageMode = "chat";
      mainMessageInput.disabled = false;
      sendMainMessageBtn.disabled = false;
      mainMessageInput.placeholder = "Bilenler Odası — yalnızca doğru bilenler görür...";
      updateChatEmojiState();
    } else {
      gameMessages.classList.remove("guessed-locked", "away-locked");
      mainMessageInput.disabled = false;
      sendMainMessageBtn.disabled = false;
      applyMessageTargetAfterState();
      updateChatEmojiState();
    }
  }

  applyWhisperComposerOverride();
}


function updateAwayHeaderButton(players = latestPlayers) {
  if (!awayToggleBtn) return;

  const me = players.find((player) => player.id === mySocketId);

  if (!me) {
    awayToggleBtn.classList.remove("active");
    awayToggleBtn.classList.add("disabled-drawer");
    awayToggleBtn.textContent = "○ AWAY";
    awayToggleBtn.disabled = true;
    return;
  }

  const iAmDrawingNow = me.id === currentDrawerId && latestGameState && latestGameState.status === "playing";

  awayToggleBtn.disabled = iAmDrawingNow;
  awayToggleBtn.classList.toggle("disabled-drawer", iAmDrawingNow);

  if (me.away) {
    awayToggleBtn.classList.add("active");
    awayToggleBtn.textContent = "● AWAY";
  } else {
    awayToggleBtn.classList.remove("active");
    awayToggleBtn.textContent = "○ AWAY";
  }

  awayToggleBtn.title = iAmDrawingNow
    ? "Çizim sırası sendeyken AWAY açılamaz"
    : "Çizim sırasını aç/kapat";
}

if (awayToggleBtn) {
  awayToggleBtn.addEventListener("click", () => {
    socket.emit("toggleAway");
  });
}


function renderPlayers(players = latestPlayers) {
  playersList.innerHTML = "";
  userCountText.textContent = players.length;

  iHaveGuessed = false;
  const selfPlayer = players.find((player) => player.id === mySocketId);
  if (selfPlayer) iAmAway = selfPlayer.away === true;

  const sortedPlayers = [...players].sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "tr");
  });

  const uniqueScores = [...new Set(
    sortedPlayers
      .map((player) => Number(player.score || 0))
      .filter((score) => score > 0)
  )].sort((a, b) => b - a);

  function trophyForPlayer(player) {
    if (player.waitingNextRound) return "";

    const score = Number(player.score || 0);
    if (score <= 0) return "";

    const scoreRank = uniqueScores.indexOf(score) + 1;

    if (scoreRank === 1) return "🏆";
    if (scoreRank === 2) return "🥈";
    if (scoreRank === 3) return "🥉";
    return "";
  }

  sortedPlayers.forEach((player) => {
    const li = document.createElement("li");

    if (player.id === currentDrawerId) {
      li.classList.add("drawer");
      li.title = "Şu an çizen oyuncu";
    }

    if (player.guessed) {
      li.classList.add("guessed");
    }

    if (player.away) {
      li.classList.add("away-player");
    }

    if (player.isAdmin === true) {
      li.classList.add("admin-player");
    }

    if (player.id === mySocketId && player.guessed) {
      iHaveGuessed = true;
    }

    const trophy = trophyForPlayer(player);
    const waitingLabel = "";
li.dataset.playerId = player.id;
    li.dataset.playerName = player.name || "";

    const adminBadge = player.isAdmin === true ? '<span class="admin-player-badge">👑 YÖNETİCİ</span>' : '';
    li.innerHTML = `
      <span class="player-name-cell"><span class="player-trophy">${trophy}</span>${adminBadge}<span class="player-visible-name">${escapeHtml(player.name)}</span> ${waitingLabel}</span>
      <span class="player-score-cell">${player.score}</span>
    `;

    playersList.appendChild(li);
  });

  updateAwayHeaderButton(players);
  updateTurnButtons();
}


if (playersList) {
  playersList.addEventListener("contextmenu", (event) => {
    const li = event.target.closest("li");
    if (!li || !playerContextMenu || !currentAuthUser) return;

    const playerId = li.dataset.playerId || "";
    const playerName = li.dataset.playerName || "";
    const targetPlayerData = latestPlayers.find((item) => item.id === playerId) || null;

    // SFD SKETCH yöneticisinde hiçbir oyuncu sağ tık menüsü açamaz.
    if (targetPlayerData && targetPlayerData.isAdmin === true) {
      event.preventDefault();
      closePlayerContextMenu();
      return;
    }

    const isSelf = playerId === mySocketId || (currentAuthUser && currentAuthUser.username === playerName);

    if (isSelf) {
      closePlayerContextMenu();
      return;
    }

    event.preventDefault();

    const friendRecord = (latestFriendsData.friends || []).find((item) => item.username === playerName) || null;
    const isFriend = Boolean(friendRecord);
    const hasSent = (latestFriendsData.sentRequests || []).some((item) => item.username === playerName);
    const hasIncoming = (latestFriendsData.requests || []).some((item) => item.username === playerName);
    const isBlocked = (latestFriendsData.blockedUsers || []).some((item) => item.username === playerName);
    contextMenuTargetPlayer = {
      id: playerId,
      name: playerName,
      accountId: targetPlayerData ? String(targetPlayerData.userId || "") : (friendRecord ? String(friendRecord.id || "") : ""),
      isAdmin: targetPlayerData ? targetPlayerData.isAdmin === true : false,
      friendAction: isFriend ? "remove" : "add"
    };

    if (ctxAddFriendBtn) {
      ctxAddFriendBtn.dataset.friendAction = isFriend ? "remove" : "add";
      ctxAddFriendBtn.classList.toggle("friend-remove-mode", isFriend);
      ctxAddFriendBtn.disabled = isSelf || hasSent || hasIncoming || isBlocked;
      if (isFriend) ctxAddFriendBtn.textContent = "Arkadaşlıktan çıkar";
      else if (hasSent) ctxAddFriendBtn.textContent = "✓ İstek gönderildi";
      else if (hasIncoming) ctxAddFriendBtn.textContent = "Senden istek var";
      else if (isBlocked) ctxAddFriendBtn.textContent = "Engellenmiş";
      else if (isSelf) ctxAddFriendBtn.textContent = "Kendin";
      else ctxAddFriendBtn.textContent = "Arkadaş ekle";
    }

    if (ctxBlockBtn) {
      ctxBlockBtn.disabled = isSelf || isBlocked || contextMenuTargetPlayer.isAdmin === true;
      ctxBlockBtn.textContent = contextMenuTargetPlayer.isAdmin === true
        ? "Yönetici engellenemez"
        : (isBlocked ? "Engellenmiş" : "Oyuncuyu Engelle");
    }

    if (adminContextSection) {
      adminContextSection.classList.toggle(
        "hidden",
        !(currentAuthUser && currentAuthUser.isAdmin === true) || isSelf || contextMenuTargetPlayer.isAdmin === true
      );
    }

    if (ctxWhisperBtn) {
      ctxWhisperBtn.disabled = isSelf || isBlocked;
      ctxWhisperBtn.textContent = isBlocked ? "💬 Fısıltı (engelli)" : `💬 ${playerName} oyuncusuna fısılda`;
    }

    ctxReactionButtons.forEach((button) => {
      button.disabled = isSelf || isBlocked || Date.now() < playerReactionCooldownUntil;
      button.title = isBlocked
        ? "Engellediğin oyuncuya etkileşim gönderemezsin."
        : `${playerName} oyuncusuna ses gönder`;
    });

    playerContextMenu.style.left = `${event.clientX + 4}px`;
    playerContextMenu.style.top = `${event.clientY + 4}px`;
    playerContextMenu.classList.remove("hidden");
  });
}



if (chatMessages) {
  chatMessages.addEventListener("contextmenu", (event) => {
    const nameElement = event.target.closest(".chat-player-name");
    if (!nameElement || !playersList || !playerContextMenu || !currentAuthUser) return;

    const playerName = String(nameElement.dataset.playerName || "").trim();
    if (!playerName) return;

    const matchingPlayerRow = Array.from(playersList.querySelectorAll("li")).find((item) => {
      return String(item.dataset.playerName || "").trim() === playerName;
    });

    if (!matchingPlayerRow) {
      closePlayerContextMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    matchingPlayerRow.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY
    }));
  });
}


if (playerContextMenu) {
  document.addEventListener("click", (event) => {
    if (!playerContextMenu.contains(event.target)) {
      closePlayerContextMenu();
    }
  });

  document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("#playersList")) {
      closePlayerContextMenu();
    }
  });

  window.addEventListener("blur", closePlayerContextMenu);
}

function getAdminReason(defaultReason = "Yönetici kararı") {
  const value = window.prompt("İşlem sebebi:", defaultReason);
  if (value === null) return null;
  return String(value || defaultReason).trim().slice(0, 160) || defaultReason;
}

function emitAdminBan(durationMs, banIp = false) {
  if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.id) return;
  const reason = getAdminReason(banIp ? "IP banı" : "Kural ihlali");
  if (reason === null) return;
  const target = { ...contextMenuTargetPlayer };
  closePlayerContextMenu();
  socket.emit("adminBanPlayer", {
    targetSocketId: target.id,
    durationMs: Math.max(0, Number(durationMs || 0)),
    banIp: banIp === true,
    reason
  });
}

if (ctxAdminKickBtn) {
  ctxAdminKickBtn.addEventListener("click", () => {
    if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.id) return;
    const reason = getAdminReason("Yönetici kararı");
    if (reason === null) return;
    const targetId = contextMenuTargetPlayer.id;
    closePlayerContextMenu();
    socket.emit("adminKickPlayer", { targetSocketId: targetId, reason });
  });
}

if (ctxAdminSkipBtn) {
  ctxAdminSkipBtn.addEventListener("click", () => {
    closePlayerContextMenu();
    socket.emit("adminSkipTurn");
  });
}

ctxAdminBanButtons.forEach((button) => {
  button.addEventListener("click", () => emitAdminBan(Number(button.dataset.duration || 0), false));
});

if (ctxAdminIpBanBtn) {
  ctxAdminIpBanBtn.addEventListener("click", () => emitAdminBan(0, true));
}

if (ctxWhisperBtn) {
  ctxWhisperBtn.addEventListener("click", () => {
    if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.name || ctxWhisperBtn.disabled) return;
    const targetName = contextMenuTargetPlayer.name;
    closePlayerContextMenu();
    setWhisperTarget(targetName, true);
  });
}

if (ctxAddFriendBtn) {
  ctxAddFriendBtn.addEventListener("click", async () => {
    if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.name) return;
    if (ctxAddFriendBtn.disabled) return;

    const target = { ...contextMenuTargetPlayer };
    const action = ctxAddFriendBtn.dataset.friendAction === "remove" || target.friendAction === "remove"
      ? "remove"
      : "add";

    if (action === "remove") {
      const confirmed = await showWinConfirm(`"${target.name}" oyuncusunu arkadaşlıktan çıkarmak istiyor musun?`);
      if (!confirmed) return;

      const data = await apiJson("/api/friend-remove", {
        method: "POST",
        body: JSON.stringify({ userId: target.accountId || "", username: target.name })
      });

      if (data.ok) {
        latestFriendsData = {
          friends: data.friends || [],
          requests: data.requests || [],
          sentRequests: data.sentRequests || [],
          blockedUsers: data.blockedUsers || [],
          requestCount: data.requestCount || 0
        };
        updateFriendsBadge(latestFriendsData.requestCount);
        showWinNotification(data.message || "Arkadaşlıktan çıkarıldı.", "success");
      } else {
        showWinNotification(data.message || "Arkadaşlıktan çıkarılamadı.", "error");
      }

      renderFriends(true);
      closePlayerContextMenu();
      return;
    }

    const data = await apiJson("/api/friend-request", {
      method: "POST",
      body: JSON.stringify({ username: target.name })
    });

    if (data.ok) {
      latestFriendsData = {
        ...latestFriendsData,
        sentRequests: data.sentRequests || latestFriendsData.sentRequests || [],
        requests: data.requests || latestFriendsData.requests || [],
        friends: data.friends || latestFriendsData.friends || [],
        blockedUsers: data.blockedUsers || latestFriendsData.blockedUsers || [],
        requestCount: data.requestCount ?? latestFriendsData.requestCount ?? 0
      };
      updateFriendsBadge(latestFriendsData.requestCount);
      ctxAddFriendBtn.textContent = "✓ İstek gönderildi";
      ctxAddFriendBtn.disabled = true;
      showWinNotification(data.message || "Arkadaşlık isteği gönderildi.", "success");
    } else {
      showWinNotification(data.message || "İstek gönderilemedi.", "error");
    }

    renderFriends(true);
    closePlayerContextMenu();
  });
}

if (ctxBlockBtn) {
  ctxBlockBtn.addEventListener("click", async () => {
    if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.name) return;
    if (ctxBlockBtn.disabled) return;

    const target = { ...contextMenuTargetPlayer };
    const confirmed = await showWinConfirm(`"${target.name}" oyuncusunu engellemek istiyor musun?`);
    if (!confirmed) return;

    const data = await blockPlayerById(target.id || "", modalFriendMessage, target.name);
    if (data.ok) closePlayerContextMenu();
  });
}

ctxReactionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!contextMenuTargetPlayer || !contextMenuTargetPlayer.id) return;
    if (button.disabled || Date.now() < playerReactionCooldownUntil) return;

    const reaction = String(button.dataset.reaction || "");
    if (!PLAYER_REACTIONS[reaction]) return;

    playerReactionCooldownUntil = Date.now() + 1500;
    ctxReactionButtons.forEach((item) => {
      item.disabled = true;
    });

    socket.emit("sendPlayerReaction", {
      targetSocketId: contextMenuTargetPlayer.id,
      reaction
    });

    closePlayerContextMenu();
  });
});

function addGameMessage(message) {
  if (!gameMessages) return;
  const text = String(message ?? "").trim();
  if (!text) return;

  const div = document.createElement("div");
  div.className = "game-message";
  div.textContent = text;
  gameMessages.appendChild(div);
  gameMessages.scrollTop = gameMessages.scrollHeight;
}

function addGuessMessage(name, message, isAdmin = false) {
  if (!gameMessages) return;
  const cleanName = String(name || "Oyuncu").trim() || "Oyuncu";
  const cleanMessage = String(message ?? "").trim();
  if (!cleanMessage) return;

  const div = document.createElement("div");
  div.className = isAdmin ? "guess-line admin-message" : "guess-line";
  div.innerHTML = `${isAdmin ? '<span class="admin-chat-badge">👑 ADMIN</span> ' : ''}<strong class="chat-player-name" data-player-name="${escapeHtml(cleanName)}" title="Oyuncu menüsünü açmak için sağ tıkla">${escapeHtml(cleanName)}</strong>: ${escapeHtml(cleanMessage)}`;
  gameMessages.appendChild(div);
  gameMessages.scrollTop = gameMessages.scrollHeight;
}

function addChatMessage(name, message, guessedOnly = false, isAdmin = false) {
  if (!chatMessages) return;
  const cleanName = String(name || "Oyuncu").trim() || "Oyuncu";
  const cleanMessage = String(message ?? "").trim();
  if (!cleanMessage) return;

  const div = document.createElement("div");
  div.className = isAdmin
    ? "chat-message admin-message"
    : (guessedOnly ? "chat-message guessed-room-message" : "chat-message");
  div.innerHTML = `${isAdmin ? '<span class="admin-chat-badge">👑 ADMIN</span> ' : ''}<strong class="chat-player-name" data-player-name="${escapeHtml(cleanName)}" title="Oyuncu menüsünü açmak için sağ tıkla">${escapeHtml(cleanName)}</strong>: ${escapeHtml(cleanMessage)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getTurkishDativeSuffix(name) {
  const lower = String(name || "").toLocaleLowerCase("tr-TR");
  const vowels = lower.match(/[aeıioöuü]/g);
  const lastVowel = vowels && vowels.length ? vowels[vowels.length - 1] : "e";
  return "aıou".includes(lastVowel) ? "a" : "e";
}

function addReactionChatMessage(senderName, targetName, actionText) {
  const sender = String(senderName || "Bir oyuncu");
  const target = String(targetName || "Oyuncu");
  const suffix = getTurkishDativeSuffix(target);
  const div = document.createElement("div");
  div.className = "reaction-chat-message";
  div.innerHTML = `<strong class="chat-player-name" data-player-name="${escapeHtml(sender)}" title="Oyuncu menüsünü açmak için sağ tıkla">${escapeHtml(sender)}</strong>, <strong class="chat-player-name" data-player-name="${escapeHtml(target)}" title="Oyuncu menüsünü açmak için sağ tıkla">${escapeHtml(target)}'${suffix}</strong> ${escapeHtml(actionText)}.`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

socket.on("playerReaction", ({ reaction, senderName, targetName, targetId } = {}) => {
  const config = PLAYER_REACTIONS[reaction];
  if (!config) return;

  // Sesli etkileşim artık odadaki bütün oyuncularda çalar.
  playGameSound(config.sound, config.volume, 120);

  addReactionChatMessage(
    senderName || "Bir oyuncu",
    targetName || "Oyuncu",
    config.actionText || `${config.label} gönderdi`
  );
});

socket.on("playerReactionSent", () => {
  // Bildirim artık odadaki herkese Chat alanında gösteriliyor.
});

socket.on("playerReactionRejected", (message) => {
  showWinNotification(message || "Etkileşim gönderilemedi.", "warning", 2600);
});

setInterval(() => {
  if (currentAuthUser) {
    renderFriends(true);
  }
}, 10000);


if (afkVoteBtn) {
  afkVoteBtn.addEventListener("click", () => {
    if (!warningButtonVisible || isMyTurn) return;

    if (skipVoteActive) {
      skipVotePanelOpened = true;
      skipVoteShouldAlert = false;
      stopSkipVoteAlertBlink();
      updateSkipVoteOverlay();
      updateAfkVoteButton();
      return;
    }

    if (!warningButtonEnabled || warningAlreadyUsed) return;
    socket.emit("reportDrawer");
  });
}

socket.on("drawerReportAccepted", ({ usesLeft } = {}) => {
  warningUsesLeft = Math.max(0, Number(usesLeft || 0));
  updateAfkVoteButton();
});

socket.on("drawerReportRejected", (message) => {
  if (message) showWinNotification(message, "warning", 3500);
  updateAfkVoteButton();
});

socket.on("drawerReportReset", () => {
  warningAlreadyUsed = false;
  updateAfkVoteButton();
});


function applySkipVotePayload({ drawerName, needed, endsAt, durationMs, fastTrack } = {}, openPanel = false) {
  if (isMyTurn) {
    skipVoteActive = false;
    skipVotePanelOpened = false;
    stopSkipVoteAlertBlink();
    stopSkipVoteCountdown();
    updateSkipVoteOverlay();
    updateAfkVoteButton();
    return;
  }

  skipVoteActive = true;
  skipVoteCanVote = true;
  skipVoteHasVoted = false;
  skipVotePanelOpened = openPanel || skipVotePanelOpened;
  skipVoteShouldAlert = !openPanel && !skipVotePanelOpened;
  if (skipVoteShouldAlert) {
    startSkipVoteAlertBlink();
  } else {
    stopSkipVoteAlertBlink();
  }
  skipVoteOverlay?.classList.remove("minimized");
  skipVoteYesCount = 0;
  skipVoteNoCount = 0;
  skipVoteRequired = Math.max(1, Number(needed || 1));
  skipVoteFastTrack = fastTrack === true;
  skipVoteEndsAt = Math.max(
    0,
    Number(endsAt || 0) || (Date.now() + Math.max(1000, Number(durationMs || 15000)))
  );

  if (skipVoteDescription) {
    const extra = skipVoteFastTrack
      ? " Bu oyuncu daha önce iki kez cezalandırıldığı için 1 Evet oyu yeterli."
      : "";
    skipVoteDescription.textContent = `${drawerName || "Çizen oyuncu"} için tur atlatılsın mı?${extra}`;
  }

  startSkipVoteCountdown(skipVoteEndsAt);
  updateSkipVoteOverlay();
  updateAfkVoteButton();
}

// Oylamayı başlatan oyuncuda popup hemen açılır.
socket.on("skipVoteStarted", (payload = {}) => {
  applySkipVotePayload(payload, true);
});

// Diğer oyuncularda popup açılmaz; sarı ünlem kırmızı-sarı yanıp söner.
socket.on("skipVoteInvitation", (payload = {}) => {
  applySkipVotePayload(payload, false);
  // Olay doğrudan geldiyse state paketinden bağımsız olarak alarmı kilitle.
  if (!isMyTurn && !skipVotePanelOpened && !skipVoteHasVoted) {
    startSkipVoteAlertBlink();
    updateAfkVoteButton();
  }
});

socket.on("skipVoteUpdated", ({ yesCount, noCount, needed } = {}) => {
  skipVoteYesCount = Math.max(0, Number(yesCount || 0));
  skipVoteNoCount = Math.max(0, Number(noCount || 0));
  skipVoteRequired = Math.max(1, Number(needed || skipVoteRequired || 1));
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

socket.on("skipVotePassed", () => {
  skipVoteActive = false;
  skipVoteCanVote = false;
  skipVoteHasVoted = false;
  skipVotePanelOpened = false;
  skipVoteShouldAlert = false;
  stopSkipVoteAlertBlink();
  stopSkipVoteCountdown();
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

socket.on("skipVoteFailed", () => {
  skipVoteActive = false;
  skipVoteCanVote = false;
  skipVoteHasVoted = false;
  skipVotePanelOpened = false;
  skipVoteShouldAlert = false;
  stopSkipVoteAlertBlink();
  stopSkipVoteCountdown();
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

function isVisibleGameSystemMessage(message) {
  const text = String(message || "").trim();
  if (!text) return false;

  const isVoteMessage = /(Turu Atlat|oylama|vote)/i.test(text);

  return (
    /^Çizim sırası:\s*.+$/i.test(text) ||
    /^.+\s+kelimeyi doğru bildi!\s*\+\d+\s*puan$/i.test(text) ||
    isVoteMessage
  );
}

socket.on("systemMessage", (message) => {
  const cleanMessage = String(message || "").trim();
  const waitingMatch = cleanMessage.match(/^Oyun için\s+(\d+)\s+oyuncu daha lazım\.?$/i);

  if (waitingMatch) {
    setViewerStatusMessage(`Oyun için ${waitingMatch[1]} oyuncu daha lazım.`, "waiting");
    removeWaitingPlayerMessagesFromGameLog();
    return;
  }

  // Game / Tahmin günlüğünde yalnızca çizim sırası ve doğru bilen +puan mesajları görünür.
  if (!isVisibleGameSystemMessage(cleanMessage)) return;
  addGameMessage(cleanMessage);
});

socket.on("awayGuessBlocked", () => {
  iAmAway = true;
  setMessageTarget("chat", true);
  showWinNotification("AWAY modundayken tahmin yazamazsın; yalnızca Chat kullanabilirsin.", "warning", 2800);
  updateTurnButtons();
});

socket.on("whisperMessage", (payload = {}) => {
  addWhisperMessage(payload);
  if (payload.direction === "incoming") {
    playGameSound("whisper", 0.86, 120);
    if (document.hidden) {
      showWinNotification(`${payload.from || "Bir oyuncu"} sana fısıldadı.`, "info", 3200);
    }
  }
});

socket.on("whisperRejected", (message) => {
  showWinNotification(message || "Fısıltı gönderilemedi.", "error", 3300);
});

socket.on("chatMessage", ({ name, message, guessedOnly, isAdmin }) => {
  addChatMessage(name, message, guessedOnly === true, isAdmin === true);
});

socket.on("nearGuess", ({ message } = {}) => {
  const div = document.createElement("div");
  div.className = "near-guess-message";
  div.textContent = message || "Çok Yakın!";
  gameMessages.appendChild(div);
  gameMessages.scrollTop = gameMessages.scrollHeight;
});

socket.on("guessMessage", ({ name, message, isAdmin }) => {
  addGuessMessage(name, message, isAdmin === true);
});

function formatAdminBanUntil(until) {
  const value = Number(until || 0);
  return value > 0 ? new Date(value).toLocaleString("tr-TR") : "Kalıcı";
}

function renderAdminBanList(container, items, type) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    container.innerHTML = '<div class="admin-empty">Aktif yasak yok.</div>';
    return;
  }
  list.forEach((ban) => {
    const row = document.createElement("div");
    row.className = "admin-ban-row";
    const key = type === "ip" ? String(ban.ip || ban.networkScope || ban.deviceId || "") : String(ban.userId || "");
    row.innerHTML = `
      <div><b>${escapeHtml(ban.displayName || ban.username || ban.ip || "Bilinmiyor")}</b><span>${escapeHtml(ban.reason || "Yönetici kararı")} • ${escapeHtml(formatAdminBanUntil(ban.until))}</span></div>
      <button type="button">Yasağı Kaldır</button>`;
    row.querySelector("button").addEventListener("click", () => {
      socket.emit("adminUnban", type === "ip"
        ? (ban.networkScope
          ? { networkScope: String(ban.networkScope) }
          : (ban.deviceId ? { deviceId: String(ban.deviceId) } : { ip: key }))
        : { userId: key });
    });
    container.appendChild(row);
  });
}

function renderAdminPanel(data = {}) {
  if (adminPanelRoom) adminPanelRoom.textContent = data.roomName || "Lobi";
  if (adminPanelWord) adminPanelWord.textContent = data.currentWord || "-";
  if (adminPanelPauseState) adminPanelPauseState.textContent = data.paused ? "Durduruldu" : "Aktif";
  if (typeof data.adminHidden === "boolean") setAdminStealthPreference(data.adminHidden, true);
  renderAdminBanList(adminUserBans, data.userBans, "user");
  renderAdminBanList(adminIpBans, data.ipBans, "ip");
  renderAdminBanList(adminLobbyUserBans, data.userBans, "user");
  renderAdminBanList(adminLobbyIpBans, data.ipBans, "ip");
}

function openUnifiedAdminPanel() {
  if (!adminLobbyModal || !currentAuthUser?.isAdmin) return;
  // Modal ana sayfa kapsayıcısında olsa bile oyun ekranındayken görünmesi için body altına taşı.
  if (adminLobbyModal.parentElement !== document.body) document.body.appendChild(adminLobbyModal);
  syncAdminStealthControls();
  openManagedModal(adminLobbyModal);
  socket.emit("adminGetPanelData");
}

if (lobbyAdminBtn) lobbyAdminBtn.addEventListener("click", openUnifiedAdminPanel);
if (adminLobbyCloseBtn) adminLobbyCloseBtn.addEventListener("click", () => closeManagedModal(adminLobbyModal));
if (adminLobbyStealthToggle) adminLobbyStealthToggle.addEventListener("change", () => {
  const hidden = adminLobbyStealthToggle.checked === true;
  setAdminStealthPreference(hidden, true);
  if (currentRoomId) socket.emit("adminSetHiddenMode", { hidden });
  showWinNotification(hidden
    ? (currentRoomId ? "Bu odada gizli yönetici modu açıldı." : "Gizli yönetici modu sonraki oda girişinde kullanılacak.")
    : (currentRoomId ? "Bu odada yönetici görünür oldu." : "Yönetici odalarda görünür olacak."), "success", 2800);
});

function updateLobbyBanButtonLabel() {
  if (!adminLobbyBanBtn || !adminLobbyBanDuration) return;
  adminLobbyBanBtn.textContent = adminLobbyBanDuration.value === "ip" ? "IP Banla" : "Hesabı Banla";
}

function submitLobbyUsernameBan() {
  const username = String(adminLobbyBanUsername?.value || "").trim();
  const selectedValue = String(adminLobbyBanDuration?.value || "0");
  const reason = String(adminLobbyBanReason?.value || "Yönetici kararı").trim();
  if (!username) {
    showWinNotification("Banlanacak kullanıcı adını yazmalısın.", "warning", 3000);
    adminLobbyBanUsername?.focus();
    return;
  }

  const isIpBan = selectedValue === "ip";
  const durationMs = isIpBan ? 0 : Math.max(0, Number(selectedValue || 0));
  socket.emit("adminBanByUsername", {
    username,
    durationMs,
    reason,
    banType: isIpBan ? "ip" : "account"
  });
}

if (adminLobbyBanDuration) {
  adminLobbyBanDuration.addEventListener("change", updateLobbyBanButtonLabel);
  updateLobbyBanButtonLabel();
}
if (adminLobbyBanBtn) adminLobbyBanBtn.addEventListener("click", submitLobbyUsernameBan);
if (adminLobbyBanUsername) adminLobbyBanUsername.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitLobbyUsernameBan();
  }
});
if (adminLobbyBanReason) adminLobbyBanReason.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitLobbyUsernameBan();
  }
});

if (adminRoomStealthToggle) adminRoomStealthToggle.addEventListener("change", () => {
  const hidden = adminRoomStealthToggle.checked === true;
  setAdminStealthPreference(hidden, true);
  socket.emit("adminSetHiddenMode", { hidden });
});

if (adminPauseBtn) adminPauseBtn.addEventListener("click", () => socket.emit("adminPauseToggle"));
if (adminSkipBtn) adminSkipBtn.addEventListener("click", () => socket.emit("adminSkipTurn"));
if (adminClearBtn) adminClearBtn.addEventListener("click", () => socket.emit("adminClearCanvas"));
if (adminPanelBtn) adminPanelBtn.addEventListener("click", openUnifiedAdminPanel);

socket.on("adminPanelData", renderAdminPanel);
socket.on("adminHiddenModeChanged", ({ hidden } = {}) => {
  setAdminStealthPreference(hidden === true, true);
});
socket.on("adminActionResult", ({ ok, message, action } = {}) => {
  showWinNotification(message || (ok ? "Admin işlemi tamamlandı." : "Admin işlemi başarısız."), ok ? "success" : "error", 3600);
  if (ok && (action === "username-ban" || action === "ip-ban")) {
    if (adminLobbyBanUsername) adminLobbyBanUsername.value = "";
    if (adminLobbyBanReason) adminLobbyBanReason.value = "";
  }
  if (ok && (action === "username-ban" || action === "ip-ban" || action === "unban")) {
    socket.emit("adminGetPanelData");
  }
});
socket.on("adminAnnouncement", ({ name, message } = {}) => {
  addChatMessage(name || "SFD SKETCH", message || "", false, true);
});

socket.on("joinError", (message) => {
  showWinNotification(message, "error");
});

socket.on("kickedFromRoom", (message) => {
  resetLocalAfkVote();
  showWinNotification(message || "Odadan atıldın.", "warning", 6200);
  currentRoomId = null;
  gameScreen.classList.add("hidden");
  lobbyScreen.classList.remove("hidden");
  socket.emit("getRooms");
});

gameMessages.addEventListener("click", () => {
  // Tahmin alanına geçildiğinde açık fısıltı hedefi otomatik temizlenir.
  if (whisperModeActive) closeWhisperMode();

  if (isMyTurn || iHaveGuessed) return;

  if (iAmAway) {
    playGameSound("click", 0.45, 120);
    setMessageTarget("chat", true);
    return;
  }

  if (currentGameStatus === "waiting" || currentGameStatus === "starting") {
    playGameSound("click", 0.45, 120);
    setMessageTarget("chat", true);
    return;
  }

  playGameSound("click", 0.45, 120);
  setMessageTarget("guess", true);
});

chatMessages.addEventListener("click", () => {
  // Chat alanına geçildiğinde açık fısıltı hedefi otomatik temizlenir.
  if (whisperModeActive) closeWhisperMode();

  if (isMyTurn) return;

  playGameSound("click", 0.45, 120);
  setMessageTarget("chat", true);
});

if (chatEmojiBtn) {
  chatEmojiBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleChatEmojiPicker();
  });
}

if (chatEmojiCloseBtn) {
  chatEmojiCloseBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeChatEmojiPicker();
  });
}

if (emojiSearchInput) {
  emojiSearchInput.addEventListener("input", () => {
    renderEmojiGrid();
  });

  emojiSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeChatEmojiPicker();
      mainMessageInput.focus();
    }
  });
}

if (chatEmojiPicker) {
  chatEmojiPicker.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".chat-emoji-wrap")) {
    closeChatEmojiPicker();
  }
});

renderChatEmojiPicker();
updateChatEmojiState();

if (whisperTargetAcceptBtn) {
  whisperTargetAcceptBtn.addEventListener("click", confirmWhisperTarget);
}

if (whisperTargetCloseBtn) {
  whisperTargetCloseBtn.addEventListener("click", closeWhisperMode);
}

if (whisperTargetInput) {
  whisperTargetInput.addEventListener("input", () => {
    whisperTargetUsername = normalizeWhisperTarget(whisperTargetInput.value);
    applyWhisperComposerOverride();
  });

  whisperTargetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmWhisperTarget();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeWhisperMode();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "F1") {
    event.preventDefault();
    if (!currentAuthUser) return;
    openWhisperTargetChooser();
  } else if (event.key === "Escape" && whisperModeActive && !event.target.closest(".modal")) {
    closeWhisperMode();
  }
});

function isMobileFastComposer() {
  return Boolean(document.body && document.body.classList.contains("sfd-mobile-landscape"));
}

function refocusMobileComposer(mode = activeMessageMode) {
  if (!mainMessageInput || mainMessageInput.disabled || !isMobileFastComposer()) return;

  window.requestAnimationFrame(() => {
    try {
      mainMessageInput.focus({ preventScroll: true });
    } catch (err) {
      mainMessageInput.focus();
    }
    const end = mainMessageInput.value.length;
    try { mainMessageInput.setSelectionRange(end, end); } catch (err) {}
  });
}

if (sendMainMessageBtn) {
  // iPhone'da Gönder'e dokunurken input odağını kaybetme; klavye açık kalsın.
  sendMainMessageBtn.addEventListener("pointerdown", (event) => {
    if (isMobileFastComposer()) event.preventDefault();
  });
  sendMainMessageBtn.addEventListener("click", sendMainMessage);
}

mainMessageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    sendMainMessage();
  }
});

function sendMainMessage() {
  const message = mainMessageInput.value.trim();

  if (!message) {
    refocusMobileComposer();
    return;
  }

  if (whisperModeActive) {
    const targetUsername = normalizeWhisperTarget(whisperTargetInput ? whisperTargetInput.value : whisperTargetUsername);
    if (!targetUsername) {
      showWinNotification("Önce Kime alanına oyuncu adını yazmalısın.", "warning");
      whisperTargetInput?.focus();
      return;
    }
    whisperTargetUsername = targetUsername;
    lastWhisperTargetUsername = targetUsername;
    socket.emit("sendWhisper", { targetUsername, message });
    mainMessageInput.value = "";
    refocusMobileComposer("chat");
    return;
  }

  if (currentGameStatus === "waiting" || currentGameStatus === "starting") {
    socket.emit("normalChat", message);
    mainMessageInput.value = "";
    setMessageTarget("chat", false);
    refocusMobileComposer("chat");
    return;
  }

  if (isMyTurn) {
    showWinNotification("Çizen oyuncu mesaj yazamaz.", "warning");
    return;
  }

  if (iAmAway) {
    socket.emit("normalChat", message);
    mainMessageInput.value = "";
    setMessageTarget("chat", false);
    refocusMobileComposer("chat");
    return;
  }

  if (iHaveGuessed) {
    socket.emit("normalChat", message);
    mainMessageInput.value = "";
    setMessageTarget("chat", false);
    if (typeof window.sfdSelectMobilePanel === "function") {
      window.sfdSelectMobilePanel("chat", { scrollToEnd: true });
    }
    refocusMobileComposer("chat");
    return;
  }

  if (activeMessageMode === "guess") {
    socket.emit("chatMessage", message);
  } else if (activeMessageMode === "chat") {
    socket.emit("normalChat", message);
  } else {
    activeMessageMode = "guess";
    setMessageTarget("guess", false);
    socket.emit("chatMessage", message);
  }

  mainMessageInput.value = "";
  refocusMobileComposer(activeMessageMode);
}

if (skipVoteYesBtn) skipVoteYesBtn.addEventListener("click", () => {
  if (!skipVoteCanVote || skipVoteHasVoted) return;
  skipVoteHasVoted = true;
  stopSkipVoteAlertBlink();
  socket.emit("voteSkipTurn", { vote: "yes" });
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

if (skipVoteNoBtn) skipVoteNoBtn.addEventListener("click", () => {
  if (!skipVoteCanVote || skipVoteHasVoted) return;
  skipVoteHasVoted = true;
  stopSkipVoteAlertBlink();
  socket.emit("voteSkipTurn", { vote: "no" });
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

if (skipVoteCloseBtn) skipVoteCloseBtn.addEventListener("click", () => {
  skipVotePanelOpened = false;
  updateSkipVoteOverlay();
  updateAfkVoteButton();
});

if (earHintBtn) earHintBtn.addEventListener("click", () => {
  if (!isMyTurn || earHintActive) return;
  socket.emit("useEarHint");
});

socket.on("earHintActivated", () => {
  earHintActive = true;
  updateEarHintIndicator();
});

hintBtn.addEventListener("click", () => {
  if (!isMyTurn || !hintAvailable || hintBtn.disabled) return;
  socket.emit("requestHint");
});

skipBtn.addEventListener("click", () => {
  if (!isMyTurn || skipBtn.disabled) return;

  if (canFinishTurn) {
    socket.emit("finishTurn");
    return;
  }

  if (!skipAvailable) return;
  playGameSound("skip", 0.78, 450);
  socket.emit("skipTurn");
});

if (doneBtn) {
  doneBtn.addEventListener("click", () => {
    if (!isMyTurn || !canFinishTurn || doneBtn.disabled) return;
    socket.emit("finishTurn");
  });
}

function resetStrokeAnalysis() {
  // Otomatik yazı algılama kaldırıldı; vote sistemi kullanılır.
}

function beginStrokeAnalysis() {}
function trackStrokeAnalysis() {}
function finishStrokeAnalysis() {}

function getCanvasPosition(event) {
  const rect = canvas.getBoundingClientRect();

  let clientX;
  let clientY;

  if (event && event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else if (event && event.changedTouches && event.changedTouches.length > 0) {
    clientX = event.changedTouches[0].clientX;
    clientY = event.changedTouches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  return {
    x: Math.floor((clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.floor((clientY - rect.top) * (canvas.height / rect.height))
  };
}

function startDrawing(event) {
  if (!isMyTurn || currentGameStatus !== "playing") return;

  event.preventDefault();

  const pos = getCanvasPosition(event);
  beginStrokeAnalysis(pos);
  socket.emit("drawerActivity");

  if (currentTool === "fill") {
    const data = {
      type: "fill",
      x: pos.x,
      y: pos.y,
      color: currentColor
    };

    renderAction(data);
    socket.emit("draw", data);
    currentStrokeDistance = 120;
    finishStrokeAnalysis();
    return;
  }

  if (isShapeTool(currentTool)) {
    isShapeDrawing = true;
    shapeStartX = pos.x;
    shapeStartY = pos.y;
    shapePreviewImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return;
  }

  drawing = true;
  lastX = pos.x;
  lastY = pos.y;

  if (currentTool === "spray") {
    const data = {
      type: "spray",
      x: pos.x,
      y: pos.y,
      color: currentColor,
      lineWidth: Number(lineWidthInput.value)
    };

    renderAction(data);
    socket.emit("draw", data);
  }
}

function draw(event) {
  if (!isMyTurn || currentGameStatus !== "playing") return;

  event.preventDefault();

  const pos = getCanvasPosition(event);
  trackStrokeAnalysis(pos);

  if (isShapeDrawing && isShapeTool(currentTool)) {
    if (shapePreviewImage) {
      ctx.putImageData(shapePreviewImage, 0, 0);
    }

    const previewData = {
      type: "shape",
      tool: currentTool,
      x1: shapeStartX,
      y1: shapeStartY,
      x2: pos.x,
      y2: pos.y,
      color: currentColor,
      lineWidth: Number(lineWidthInput.value),
      square: isShiftPressed
    };

    renderAction(previewData);
    return;
  }

  if (!drawing) return;

  if (currentTool === "spray") {
    const data = {
      type: "spray",
      x: pos.x,
      y: pos.y,
      color: currentColor,
      lineWidth: Number(lineWidthInput.value)
    };

    renderAction(data);
    socket.emit("draw", data);

    lastX = pos.x;
    lastY = pos.y;
    return;
  }

  const data = {
    type: "stroke",
    tool: currentTool,
    x1: lastX,
    y1: lastY,
    x2: pos.x,
    y2: pos.y,
    color: currentColor,
    lineWidth: Number(lineWidthInput.value)
  };

  renderAction(data);
  socket.emit("draw", data);

  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing(event) {
  if (isShapeDrawing && isMyTurn && currentGameStatus === "playing" && event) {
    const pos = getCanvasPosition(event);

    if (shapePreviewImage) {
      ctx.putImageData(shapePreviewImage, 0, 0);
    }

    const data = {
      type: "shape",
      tool: currentTool,
      x1: shapeStartX,
      y1: shapeStartY,
      x2: pos.x,
      y2: pos.y,
      color: currentColor,
      lineWidth: Number(lineWidthInput.value),
      square: isShiftPressed
    };

    renderAction(data);
    socket.emit("draw", data);
  }

  drawing = false;
  isShapeDrawing = false;
  shapePreviewImage = null;
  finishStrokeAnalysis();
}

function renderAction(data) {
  if (data.type === "shape") {
    ctx.save();

    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const x = Math.min(data.x1, data.x2);
    const y = Math.min(data.y1, data.y2);
    const w = Math.abs(data.x2 - data.x1);
    const h = Math.abs(data.y2 - data.y1);

    if (data.tool === "box") {
      if (data.square) {
        const size = Math.max(w, h);
        const sx = data.x2 >= data.x1 ? size : -size;
        const sy = data.y2 >= data.y1 ? size : -size;
        ctx.strokeRect(data.x1, data.y1, sx, sy);
      } else {
        ctx.strokeRect(x, y, w, h);
      }
    }

    if (data.tool === "circle") {
      const radiusX = w / 2;
      const radiusY = h / 2;
      const centerX = x + radiusX;
      const centerY = y + radiusY;

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (data.tool === "line") {
      ctx.beginPath();
      ctx.moveTo(data.x1, data.y1);
      ctx.lineTo(data.x2, data.y2);
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  if (data.type === "stroke") {
    ctx.save();

    let strokeColor = data.color;
    let width = data.lineWidth;
    let alpha = 1;

    if (data.tool === "eraser") {
      strokeColor = "#ffffff";
      width = data.lineWidth + 12;
    }

    if (data.tool === "watercolor") {
      alpha = 0.2;
      width = data.lineWidth + 10;
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.moveTo(data.x1, data.y1);
    ctx.lineTo(data.x2, data.y2);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (data.type === "spray") {
    ctx.save();

    ctx.fillStyle = data.color;
    ctx.globalAlpha = 0.65;

    const density = Math.max(12, data.lineWidth * 3);
    const radius = Math.max(8, data.lineWidth * 2);

    for (let i = 0; i < density; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const px = data.x + Math.cos(angle) * dist;
      const py = data.y + Math.sin(angle) * dist;

      ctx.fillRect(px, py, 1.5, 1.5);
    }

    ctx.restore();
    return;
  }

  if (data.type === "fill") {
    floodFill(data.x, data.y, data.color);
  }
}

function hexToRgba(hex) {
  let clean = hex.replace("#", "");

  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }

  const num = parseInt(clean, 16);

  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
    a: 255
  };
}

function colorsMatch(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function getPixel(data, index) {
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3]
  };
}

function setPixel(data, index, color) {
  data[index] = color.r;
  data[index + 1] = color.g;
  data[index + 2] = color.b;
  data[index + 3] = color.a;
}

function floodFill(startX, startY, fillHex) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const fillColor = hexToRgba(fillHex);
  const startIndex = (startY * canvas.width + startX) * 4;
  const targetColor = getPixel(data, startIndex);

  if (colorsMatch(targetColor, fillColor)) return;

  const stack = [[startX, startY]];

  while (stack.length) {
    const [x, y] = stack.pop();

    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;

    const index = (y * canvas.width + x) * 4;
    const current = getPixel(data, index);

    if (!colorsMatch(current, targetColor)) continue;

    setPixel(data, index, fillColor);

    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  ctx.putImageData(image, 0, 0);
}

let activeCanvasPointerId = null;

function cancelCanvasStroke() {
  drawing = false;
  isShapeDrawing = false;
  shapePreviewImage = null;
  activeCanvasPointerId = null;
  finishStrokeAnalysis();
}

function handleCanvasPointerDown(event) {
  if (!isMyTurn || currentGameStatus !== "playing") return;
  if (event.isPrimary === false) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  activeCanvasPointerId = event.pointerId;
  try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
  startDrawing(event);
}

function handleCanvasPointerMove(event) {
  if (activeCanvasPointerId === null || event.pointerId !== activeCanvasPointerId) return;
  draw(event);
}

function handleCanvasPointerUp(event) {
  if (activeCanvasPointerId === null || event.pointerId !== activeCanvasPointerId) return;
  stopDrawing(event);
  try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
  activeCanvasPointerId = null;
}

function handleCanvasPointerCancel(event) {
  if (activeCanvasPointerId !== null && event.pointerId !== activeCanvasPointerId) return;
  try {
    if (activeCanvasPointerId !== null) canvas.releasePointerCapture(activeCanvasPointerId);
  } catch (_) {}
  cancelCanvasStroke();
}

if (window.PointerEvent) {
  canvas.addEventListener("pointerdown", handleCanvasPointerDown, { passive: false });
  canvas.addEventListener("pointermove", handleCanvasPointerMove, { passive: false });
  canvas.addEventListener("pointerup", handleCanvasPointerUp, { passive: false });
  canvas.addEventListener("pointercancel", handleCanvasPointerCancel, { passive: false });
  canvas.addEventListener("lostpointercapture", handleCanvasPointerCancel, { passive: false });
} else {
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseleave", stopDrawing);

  canvas.addEventListener("touchstart", startDrawing, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDrawing, { passive: false });
  canvas.addEventListener("touchcancel", cancelCanvasStroke, { passive: false });
}

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

socket.on("draw", (data) => {
  renderAction(data);
});

socket.on("loadDrawing", (drawingData) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawingData.forEach((data) => {
    renderAction(data);
  });
});

socket.on("clearCanvas", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});
/* =====================================================
   V47 — Mobil yatay ekran / iOS Visual Viewport desteği
   ===================================================== */
(() => {
  const root = document.documentElement;
  const body = document.body;
  const liveInput = document.getElementById("mainMessageInput");
  const guessPanel = document.getElementById("gameMessages");
  const chatPanel = document.getElementById("chatMessages");
  const gameRoot = document.getElementById("gameScreen");
  const visualViewport = window.visualViewport || null;

  if (!root || !body) return;

  const hasTouchInput = () => (
    (navigator.maxTouchPoints || 0) > 0 ||
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    window.matchMedia?.("(hover: none)").matches === true
  );

  const syncMessageModeClass = () => {
    const chatIsActive = Boolean(chatPanel?.classList.contains("active-target"));
    const guessIsActive = Boolean(guessPanel?.classList.contains("active-target"));
    body.classList.toggle("sfd-message-mode-chat", chatIsActive && !guessIsActive);
    body.classList.toggle("sfd-message-mode-guess", guessIsActive && !chatIsActive);
  };

  const syncMobileViewport = () => {
    const viewportWidth = Math.round(visualViewport?.width || window.innerWidth || root.clientWidth || 0);
    const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || root.clientHeight || 0);
    const viewportTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
    const layoutWidth = Math.round(window.innerWidth || root.clientWidth || viewportWidth);
    const layoutHeight = Math.round(window.innerHeight || root.clientHeight || viewportHeight);
    const isLandscape = layoutWidth > layoutHeight;
    const isCompactLandscape = isLandscape && layoutWidth <= 1400 && (hasTouchInput() || layoutHeight <= 700);
    const inputFocused = isCompactLandscape && liveInput === document.activeElement && !gameRoot?.classList.contains("hidden");

    root.style.setProperty("--sfd-mobile-vh", `${Math.max(1, viewportHeight)}px`);
    root.style.setProperty("--sfd-mobile-top", `${viewportTop}px`);
    root.style.setProperty("--sfd-mobile-vw", `${Math.max(1, viewportWidth)}px`);

    body.classList.toggle("sfd-mobile-landscape", isCompactLandscape);
    // V59: iPhone'da inputa dokununca arayüzü büyüten eski odak modu kapatıldı.
    // Visual Viewport yüksekliği yine güncellenir; yalnızca sayfa/panel yakınlaştırılmaz.
    body.classList.remove("sfd-mobile-input-focused");
    body.classList.toggle("sfd-mobile-keyboard-open", inputFocused);

    if (inputFocused) {
      syncMessageModeClass();
      window.requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  };

  const scheduleViewportSync = () => {
    window.requestAnimationFrame(() => {
      syncMobileViewport();
      window.setTimeout(syncMobileViewport, 80);
    });
  };

  liveInput?.addEventListener("focus", () => {
    syncMessageModeClass();
    scheduleViewportSync();
  });

  liveInput?.addEventListener("blur", () => {
    window.setTimeout(syncMobileViewport, 120);
  });

  if (window.MutationObserver) {
    const modeObserver = new MutationObserver(() => {
      syncMessageModeClass();
      syncMobileViewport();
    });
    if (guessPanel) modeObserver.observe(guessPanel, { attributes: true, attributeFilter: ["class"] });
    if (chatPanel) modeObserver.observe(chatPanel, { attributes: true, attributeFilter: ["class"] });
    if (gameRoot) modeObserver.observe(gameRoot, { attributes: true, attributeFilter: ["class"] });
  }

  window.addEventListener("resize", scheduleViewportSync, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportSync, { passive: true });
  visualViewport?.addEventListener("resize", scheduleViewportSync, { passive: true });
  visualViewport?.addEventListener("scroll", scheduleViewportSync, { passive: true });

  syncMessageModeClass();
  syncMobileViewport();
  window.setTimeout(syncMobileViewport, 250);
})();


/* =====================================================
   V57 — iPhone panel sekmeleri (yalnızca arayüz)
   ===================================================== */
(() => {
  const body = document.body;
  const gameScreenNode = document.getElementById("gameScreen");
  const tabsRoot = document.getElementById("mobilePanelTabs");
  const guessPanelNode = document.getElementById("gameMessages");
  const chatPanelNode = document.getElementById("chatMessages");
  const playersPanelNode = document.getElementById("playersList");
  const messageInputNode = document.getElementById("mainMessageInput");

  if (!body || !tabsRoot || !guessPanelNode || !chatPanelNode || !playersPanelNode) return;

  const tabButtons = Array.from(tabsRoot.querySelectorAll("[data-mobile-panel]"));
  const validTabs = new Set(["players", "guess", "chat"]);
  let selectedTab = "guess";

  function isMobileGameLayout() {
    return body.classList.contains("sfd-mobile-landscape") &&
      gameScreenNode && !gameScreenNode.classList.contains("hidden");
  }

  function selectMobileTab(name, options = {}) {
    if (!validTabs.has(name)) name = "guess";
    selectedTab = name;

    body.classList.remove("sfd-mobile-tab-players", "sfd-mobile-tab-guess", "sfd-mobile-tab-chat");
    body.classList.add(`sfd-mobile-tab-${name}`);

    tabButtons.forEach((button) => {
      const active = button.dataset.mobilePanel === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });

    if (!isMobileGameLayout()) return;

    const panel = name === "players"
      ? playersPanelNode
      : (name === "chat" ? chatPanelNode : guessPanelNode);

    if (options.scrollToEnd !== false && name !== "players") {
      window.requestAnimationFrame(() => {
        panel.scrollTop = panel.scrollHeight;
      });
    }
  }

  // Emoji ve hızlı klavye kodu mobil paneli güvenli biçimde değiştirebilir.
  window.sfdSelectMobilePanel = selectMobileTab;

  tabsRoot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-panel]");
    if (!button) return;

    const name = button.dataset.mobilePanel;
    selectMobileTab(name, { scrollToEnd: true });

    if (name === "players") {
      messageInputNode?.blur();
      return;
    }

    // Mevcut oyun kodundaki izin, AWAY, doğru bilme ve çizen kontrollerini aynen kullan.
    if (name === "guess") guessPanelNode.click();
    if (name === "chat") chatPanelNode.click();
  });

  guessPanelNode.addEventListener("click", () => {
    if (isMobileGameLayout()) selectMobileTab("guess", { scrollToEnd: false });
  }, true);

  chatPanelNode.addEventListener("click", () => {
    if (isMobileGameLayout()) selectMobileTab("chat", { scrollToEnd: false });
  }, true);

  messageInputNode?.addEventListener("focus", () => {
    if (!isMobileGameLayout()) return;
    if (chatPanelNode.classList.contains("active-target")) {
      selectMobileTab("chat", { scrollToEnd: true });
    } else {
      selectMobileTab("guess", { scrollToEnd: true });
    }
  });

  function syncTabFromGameState() {
    if (!isMobileGameLayout()) return;

    // Doğru bilen oyuncuda Tahmin paneli görünür ve gri kalır. Oyuncu Chat'e
    // bilerek geçtiyse seçim korunur; yazı alanına dokununca Chat açılır.
    if (guessPanelNode.classList.contains("guessed-locked")) {
      if (selectedTab === "chat" && chatPanelNode.classList.contains("active-target")) {
        selectMobileTab("chat", { scrollToEnd: false });
      } else {
        selectMobileTab("guess", { scrollToEnd: false });
      }
      return;
    }

    if (chatPanelNode.classList.contains("active-target")) {
      selectMobileTab("chat", { scrollToEnd: false });
      return;
    }

    if (guessPanelNode.classList.contains("active-target")) {
      selectMobileTab("guess", { scrollToEnd: false });
      return;
    }

    selectMobileTab(selectedTab, { scrollToEnd: false });
  }

  if (window.MutationObserver) {
    const observer = new MutationObserver(syncTabFromGameState);
    observer.observe(guessPanelNode, { attributes: true, attributeFilter: ["class"] });
    observer.observe(chatPanelNode, { attributes: true, attributeFilter: ["class"] });
    if (gameScreenNode) observer.observe(gameScreenNode, { attributes: true, attributeFilter: ["class"] });
    observer.observe(body, { attributes: true, attributeFilter: ["class"] });
  }

  window.addEventListener("orientationchange", () => window.setTimeout(syncTabFromGameState, 160), { passive: true });
  window.addEventListener("resize", syncTabFromGameState, { passive: true });

  selectMobileTab("guess", { scrollToEnd: false });
  window.setTimeout(syncTabFromGameState, 250);
})();
