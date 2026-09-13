export interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
export interface SpeechRecognitionPort {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { readonly resultIndex: number; readonly results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionPort;
    webkitSpeechRecognition?: new () => SpeechRecognitionPort;
  }
}
export function createSpeechInput(host: Pick<Window, "SpeechRecognition" | "webkitSpeechRecognition">): SpeechRecognitionPort | null {
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}
export function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "麦克风或语音服务权限被拒绝。你可以继续键盘输入。";
    case "no-speech": return "没有识别到语音。可重新口述或继续键盘输入。";
    case "audio-capture": return "未找到可用的麦克风。你可以继续键盘输入。";
    case "network": return "浏览器语音服务连接失败。尚未保存，可继续键盘输入。";
    case "aborted": return "口述已取消，原有文字保留。";
    default: return "语音输入未完成（" + code + "），可继续键盘输入。";
  }
}

export function speechControlDisabled(parentDisabled: boolean, listening: boolean): boolean {
  return parentDisabled && !listening;
}
