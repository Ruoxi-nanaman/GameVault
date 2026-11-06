import { Crown, Flame, LockKeyhole, Shield, Swords, Trophy } from 'lucide-react'

export const achievementGames = [
  { id: 1, title: 'ELDEN RING', achievements: 28, total: 42, cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg' },
  { id: 2, title: 'Cyberpunk 2077', achievements: 18, total: 44, cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg' },
  { id: 3, title: 'Hades', achievements: 100, total: 100, cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg' },
  { id: 5, title: 'Hollow Knight', achievements: 38, total: 63, cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg' },
  { id: 7, title: 'Stardew Valley', achievements: 24, total: 40, cover: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg' },
]

export const achievements = [
  { id: 1, gameId: 1, title: 'Shardbearer Godrick', description: 'Defeat Godrick the Grafted', unlocked: false, rarity: 87.8, icon: Swords, date: null },
  { id: 2, gameId: 1, title: 'Great Rune', description: 'Restore the power of a Great Rune', unlocked: false, rarity: 72.4, icon: Shield, date: null },
  { id: 3, gameId: 1, title: 'Roundtable Hold', description: 'Arrive at Roundtable Hold', unlocked: false, rarity: 26.1, icon: Flame, date: null },
  { id: 4, gameId: 1, title: 'Legendary Armaments', description: 'Acquire legendary armaments', unlocked: false, rarity: 15.2, icon: Crown, date: null },
  { id: 5, gameId: 1, title: 'Age of the Stars', description: 'Achieve the Age of the Stars ending', unlocked: false, rarity: 27.2, icon: Trophy, date: null },
  { id: 6, gameId: 1, title: 'Elden Lord', description: 'Become the Elden Lord', unlocked: false, rarity: 24.9, icon: Crown, date: null },
  { id: 7, gameId: 2, title: 'The Devil', description: 'Complete the Devil ending', unlocked: true, rarity: 31.6, icon: LockKeyhole, date: 'May 3, 2025' },
  { id: 8, gameId: 3, title: 'Godslayer', description: 'Escape the Underworld', unlocked: true, rarity: 18.4, icon: Flame, date: 'Apr 18, 2025' },
  { id: 9, gameId: 5, title: 'A True Master', description: 'Reach the top of the mountain', unlocked: true, rarity: 22.3, icon: Trophy, date: 'Mar 12, 2025' },
]
