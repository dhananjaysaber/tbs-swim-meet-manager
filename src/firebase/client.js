import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyA8_muLtQPydxAPT094zi5G__drWuOua5I',
  authDomain: 'panthers-swim-meet-manager.firebaseapp.com',
  databaseURL:
    'https://panthers-swim-meet-manager-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'panthers-swim-meet-manager',
  storageBucket: 'panthers-swim-meet-manager.firebasestorage.app',
  messagingSenderId: '667982878641',
  appId: '1:667982878641:web:fb676a9dd24bdfd5458f90',
};

export const app = initializeApp(firebaseConfig);
