import React, { useState, useRef, useEffect } from 'react';
import { Bell, Check, Trash2 } from 'lucide-react';
import { Notification as AppNotification } from '../types';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

interface NotificationBellProps {
  notifications: AppNotification[];
  onNotificationClick?: (notification: AppNotification) => void;
}

export default function NotificationBell({ notifications, onNotificationClick }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false); // Nuovo stato per il caricamento
  const dropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCountRef = useRef(notifications.length);
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (notifications.length > prevCountRef.current) {
      const newNotif = notifications[0]; 
      
      if (audioRef.current) {
        audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        const notif = new Notification(newNotif.title, {
          body: newNotif.message,
          icon: '/favicon.ico',
          tag: newNotif.id,
          requireInteraction: true
        });

        notif.onclick = () => {
          if (onNotificationClick) {
            onNotificationClick(newNotif);
          }
          if (newNotif.type === 'proposal_declined') {
            window.dispatchEvent(new CustomEvent('special-notification-click', { detail: newNotif }));
          }

          notif.close();
          window.focus();
        };
      }
    }
    prevCountRef.current = notifications.length;
  }, [notifications, onNotificationClick]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  // 🚀 NUOVA FUNZIONE: Elimina tutte le notifiche non lette in un solo colpo
  const handleClearAllUnread = async () => {
    const unreadNotifs = notifications.filter(n => !n.read);
    if (unreadNotifs.length === 0) return;
    
    setIsClearing(true);
    try {
      const batch = writeBatch(db);
      unreadNotifs.forEach(notif => {
        const notifRef = doc(db, 'notifications', notif.id!);
        batch.delete(notifRef);
      });
      await batch.commit();
    } catch (error) {
      console.error('Error clearing unread notifications:', error);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3" preload="auto" />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
      >
        <Bell size={24} className={cn(unreadCount > 0 ? "text-white" : "text-gray-400")} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-x-4 top-20 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 bg-white/95 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl z-[150] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="p-4 border-b border-gray-100/50 flex justify-between items-center bg-gray-50/50">
            <h3 className="font-bold">Notifiche</h3>
            
            {/* 🚀 L'intestazione ora mostra il bottone SVUOTA se ci sono notifiche non lette */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{unreadCount} non lette</span>
              {unreadCount > 0 && (
                <button 
                  onClick={handleClearAllUnread}
                  disabled={isClearing}
                  className="text-[10px] text-red-500 hover:text-red-600 uppercase font-bold tracking-wider disabled:opacity-50 flex items-center gap-1 transition-colors bg-red-50 hover:bg-red-100 px-2 py-1 rounded-md"
                >
                  <Trash2 size={12} /> {isClearing ? '...' : 'Svuota'}
                </button>
              )}
            </div>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm italic">
                Nessuna notifica
              </div>
            ) : (
              <div className="divide-y divide-gray-50/50">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (onNotificationClick) onNotificationClick(n);
                      
                      if (n.type === 'proposal_declined') {
                        window.dispatchEvent(new CustomEvent('special-notification-click', { detail: n }));
                      }
                      
                      markAsRead(n.id!);
                      setIsOpen(false); 
                    }}
                    className={cn(
                      "p-4 transition-colors group relative cursor-pointer hover:bg-gray-50",
                      !n.read ? "bg-amber-50/50" : "bg-white/30"
                    )}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-bold mb-0.5">{n.title}</div>
                        <div className="text-xs text-gray-600 line-clamp-2">{n.message}</div>
                        <div className="text-[10px] text-gray-400 mt-2">
                          {format(n.createdAt.toDate(), 'd MMM, HH:mm', { locale: it })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.read && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(n.id!);
                            }}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="Segna come letta"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Previene il click sull'intera notifica
                            deleteNotification(n.id!);
                          }}
                          className="p-1 text-red-400 hover:bg-red-50 rounded"
                          title="Elimina"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}