import { Platform } from 'react-native';

let audioModule: any = null;
let soundInstance: any = null;

async function getAudio() {
  if (!audioModule) {
    audioModule = await import('expo-av');
  }
  return audioModule;
}

function playWebBeep() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const beep = (startAt: number, freq: number, dur: number, vol = 0.35) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime + startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + dur);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + dur + 0.05);
    };
    beep(0.0,  880, 0.18);
    beep(0.22, 880, 0.18);
    beep(0.44, 1100, 0.28);
  } catch { /* silent fail on restricted contexts */ }
}

async function playNativeBeep() {
  try {
    const { Audio } = await getAudio();
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
    if (soundInstance) {
      try { await soundInstance.unloadAsync(); } catch { /* ignore */ }
      soundInstance = null;
    }
    const { sound } = await Audio.Sound.createAsync(
      require('../assets/beep.wav'),
      { shouldPlay: true, volume: 1.0, isLooping: false }
    );
    soundInstance = sound;
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (soundInstance === sound) soundInstance = null;
      }
    });
  } catch { /* silent fail */ }
}

export async function playAlertBeep() {
  if (Platform.OS === 'web') {
    playWebBeep();
  } else {
    await playNativeBeep();
  }
}

export function stopAlertBeep() {
  if (soundInstance) {
    soundInstance.stopAsync().catch(() => {});
    soundInstance.unloadAsync().catch(() => {});
    soundInstance = null;
  }
}
