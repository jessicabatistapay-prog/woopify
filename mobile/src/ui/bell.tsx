import React from 'react';
import { useRouter } from 'expo-router';
import { unreadStore, useStore } from '../state/store';
import { IconButton } from './kit';

export function BellButton() {
  const router = useRouter();
  const { count } = useStore(unreadStore);
  return <IconButton icon="notifications-outline" label={count ? `Thông báo, ${count} chưa đọc` : 'Lịch sử thông báo'} badge={count} onPress={() => router.push('/notifications')} />;
}

