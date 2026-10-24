import * as Crypto from 'expo-crypto';

export const newId = () => Crypto.randomUUID();
