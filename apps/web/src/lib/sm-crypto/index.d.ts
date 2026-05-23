import { BigInteger } from "jsbn"
import { ECPointFp, ECCurveFp } from "./ec"

export interface KeyPair {
  privateKey: string
  publicKey: string
}

export interface SignatureOptions {
  pointPool?: any[]
  der?: boolean
  hash?: boolean
  publicKey?: string
  userId?: string
}

export interface VerifyOptions {
  der?: boolean
  hash?: boolean
  userId?: string
}

export interface Point {
  k: BigInteger
  x1: BigInteger
  privateKey: string
  publicKey: string
}

// 工具函数
export function generateKeyPairHex(): KeyPair
export function getGlobalCurve(): ECCurveFp
export function parseUtf8StringToHex(input: string): string
export function parseArrayBufferToHex(input: ArrayBuffer): string
export function leftPad(input: string, num: number): string
export function arrayToHex(arr: number[]): string
export function arrayToUtf8(arr: number[]): string
export function hexToArray(hexStr: string): number[]

// 核心功能
export function doEncrypt(
  msg: string,
  publicKey: string,
  cipherMode?: number
): string
export function doDecrypt(
  encryptData: string,
  privateKey: string,
  cipherMode?: number
): string
export function doSignature(
  msg: string | ArrayBuffer,
  privateKey: string,
  options?: SignatureOptions
): string
export function doVerifySignature(
  msg: string | ArrayBuffer,
  signHex: string,
  publicKey: string,
  options?: VerifyOptions
): boolean
export function doSm3Hash(
  hashHex: string,
  publicKey: string,
  userId?: string
): string
export function getPublicKeyFromPrivateKey(privateKey: string): string
export function getPoint(): Point
