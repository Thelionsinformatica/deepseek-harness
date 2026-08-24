/** `voice` namespace dictionaries. */

/** Dictionary namespace owned by the Leon voice control. */
export const NS = 'voice'

/** Brazilian Portuguese dictionary (the product-authored language). */
export const pt = {
  'action.start': 'Iniciar voz',
  'action.stop': 'Parar gravação',
  'status.requesting': 'Solicitando microfone…',
  'status.listening': 'Leon está ouvindo…',
  'status.processing': 'Processando áudio…',
  'status.captured': 'Áudio capturado',
  'status.transcribed': 'Enviando mensagem…',
  'detail.captured': 'O áudio foi capturado, mas nenhum transcritor está configurado.',
  'detail.transcribed': 'O texto reconhecido está sendo enviado ao chat.',
  'error.permission-denied': 'Permita o acesso ao microfone nas configurações do navegador.',
  'error.no-device': 'Nenhum microfone foi encontrado.',
  'error.device-busy': 'O microfone está ocupado por outro aplicativo.',
  'error.unsupported': 'Este navegador não oferece a captura de áudio necessária.',
  'error.empty-audio': 'Nenhum áudio foi gravado. Tente novamente.',
  'error.no-speech': 'Não foi possível reconhecer fala nessa gravação.',
  'error.transcription-unavailable': 'A transcrição local está indisponível. Verifique o serviço de voz do Leon.',
  'error.transcription-failed': 'Não foi possível transformar o áudio em texto. Tente novamente.',
  'error.capture-failed': 'Não foi possível usar o microfone. Tente novamente.',
} as const

/** Locale key union. */
export type VoiceKey = keyof typeof pt

/** English dictionary. */
export const en = {
  'action.start': 'Start voice',
  'action.stop': 'Stop recording',
  'status.requesting': 'Requesting microphone…',
  'status.listening': 'Leon is listening…',
  'status.processing': 'Processing audio…',
  'status.captured': 'Audio captured',
  'status.transcribed': 'Sending message…',
  'detail.captured': 'Audio was captured, but no transcriber is configured.',
  'detail.transcribed': 'The recognized text is being sent to chat.',
  'error.permission-denied': 'Allow microphone access in your browser settings.',
  'error.no-device': 'No microphone was found.',
  'error.device-busy': 'The microphone is being used by another application.',
  'error.unsupported': 'This browser does not provide the required audio capture.',
  'error.empty-audio': 'No audio was recorded. Try again.',
  'error.no-speech': 'No speech could be recognized in this recording.',
  'error.transcription-unavailable': 'Local transcription is unavailable. Check Leon\'s voice service.',
  'error.transcription-failed': 'Leon could not turn this audio into text. Try again.',
  'error.capture-failed': 'Leon could not use the microphone. Try again.',
} satisfies Record<VoiceKey, string>

/** Simplified Chinese dictionary. */
export const zh = {
  'action.start': '开始语音',
  'action.stop': '停止录音',
  'status.requesting': '正在请求麦克风…',
  'status.listening': 'Leon 正在聆听…',
  'status.processing': '正在处理音频…',
  'status.captured': '已捕获音频',
  'status.transcribed': '正在发送消息…',
  'detail.captured': '音频已捕获，但未配置转写器。',
  'detail.transcribed': '正在将识别出的文字发送到聊天。',
  'error.permission-denied': '请在浏览器设置中允许麦克风访问。',
  'error.no-device': '未找到麦克风。',
  'error.device-busy': '麦克风正在被其他应用使用。',
  'error.unsupported': '此浏览器不支持所需的音频捕获。',
  'error.empty-audio': '没有录到音频，请重试。',
  'error.no-speech': '无法在此录音中识别语音。',
  'error.transcription-unavailable': '本地转写不可用，请检查 Leon 的语音服务。',
  'error.transcription-failed': 'Leon 无法将此音频转换为文字，请重试。',
  'error.capture-failed': 'Leon 无法使用麦克风，请重试。',
} satisfies Record<VoiceKey, string>
