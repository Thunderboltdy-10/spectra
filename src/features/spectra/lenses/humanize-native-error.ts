/**
 * Native lens/materialize failures must never reach a person as a machine code.
 * Implementation lives in the shared humanizer (CANON R13); this file is the
 * native-call-site name.
 */

export {
  humanizeNativeError,
  isMachineToken as isNativeCodeError,
} from "../bridge/humanize";
