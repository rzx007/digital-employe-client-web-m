import { doEncrypt } from "./sm-crypto"
const getHashCode = (str: string, caseSensitive = true) => {
  if (!caseSensitive) {
    str = str.toLowerCase()
  }
  let hash = 1315423911,
    i,
    ch
  for (i = str.length - 1; i >= 0; i--) {
    ch = str.charCodeAt(i)
    hash ^= (hash << 5) + ch + (hash >> 2)
  }
  return hash & 0x7fffffff
}

export const decryptPwd = (password: string) => {
  const publicKey =
    "0409e7b91101a657fd43ef2caebee42cc0bce5d771320c2c061e9ca4dac061de20f0fc372da1edef776107c2eac1436a21309e612a20e43978dd6a8b935d74305e"
  const pjKey = "1sltjcygahx2" //明文跟hash值的拼接字符串
  return doEncrypt(password + pjKey + getHashCode(password), publicKey) // sm2加密 + msg明文的hash值
}
