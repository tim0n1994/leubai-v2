import { useEffect, useRef, useState } from "react";
import { createSpeechInput, speechErrorMessage, speechControlDisabled } from "./speech-input.ts";
import type { SpeechRecognitionPort } from "./speech-input.ts";

export function SpeechInput({ onTranscript, disabled = false }: {
  readonly onTranscript: (text: string) => void;
  readonly disabled?: boolean;
}) {
  const port = useRef<SpeechRecognitionPort | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  useEffect(() => () => {
    if (port.current) {
      port.current.onresult = null;
      port.current.onerror = null;
      port.current.onend = null;
      port.current.abort();
    }
  }, []);
  const start = () => {
    if (port.current) return;
    const recognition = createSpeechInput(window);
    if (!recognition) {
      setStatus("当前浏览器不支持口述转文字，请使用键盘输入。未录音、未保存。");
      return;
    }
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = event => {
      const parts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result?.isFinal) parts.push(result[0].transcript);
      }
      if (parts.length) {
        setTranscript(current => (current ?? "") + parts.join(""));
        setStatus("转写已就绪。请核对后填入输入框；尚未保存文字或音频。");
      }
    };
    recognition.onerror = event => setStatus(speechErrorMessage(event.error));
    recognition.onend = () => { port.current = null; setListening(false); };
    port.current = recognition;
    setStatus("正在口述。浏览器语音服务可能使用联网识别；内容尚未保存。");
    setListening(true);
    try { recognition.start(); }
    catch (error) {
      port.current = null;
      setListening(false);
      setStatus("无法开始口述：" + (error instanceof Error ? error.message : String(error)));
    }
  };
  return <div>
    <button type="button" disabled={speechControlDisabled(disabled, listening)} onClick={() => listening ? port.current?.stop() : start()}>
      {listening ? "结束口述" : "口述输入"}
    </button>
    <p>口述由浏览器语音服务转写，可能联网处理。点击后才申请麦克风权限。</p>
    {status && <p role="status">{status}</p>}
    {transcript !== null && <div>
      <p style={{ whiteSpace: "pre-wrap" }}>{transcript}</p>
      <button type="button" disabled={disabled || listening} onClick={() => { onTranscript(transcript); setTranscript(null); setStatus("转写已填入，请核对后明确保存。"); }}>将转写填入输入框</button>
      <button type="button" disabled={disabled || listening} onClick={() => { setTranscript(null); setStatus("已放弃本次转写，原有文字保留。"); }}>放弃本次转写</button>
    </div>}
  </div>;
}
