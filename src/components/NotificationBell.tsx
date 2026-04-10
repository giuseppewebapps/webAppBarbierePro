import React, { useState, useRef, useEffect } from 'react';
import { Bell, Check, Trash2 } from 'lucide-react';
import { Notification as AppNotification } from '../types';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';

interface NotificationBellProps {
  notifications: AppNotification[];
  onNotificationClick?: (notification: AppNotification) => void;
}

export default function NotificationBell({ notifications, onNotificationClick }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCountRef = useRef(notifications.length);
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    // Play sound and show push notification if new notification arrives
    if (notifications.length > prevCountRef.current) {
      const newNotif = notifications[0]; // Assuming latest is first
      
      // Play sound
      if (audioRef.current) {
        audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
      }

      // Show browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const notif = new Notification(newNotif.title, {
          body: newNotif.message,
          icon: '/favicon.ico',
          tag: newNotif.id,
          requireInteraction: true
        });

        // Aggiungi click handler alla notifica push
        notif.onclick = () => {
          // Porta l'utente all'appuntamento di riferimento
          if (onNotificationClick) {
            onNotificationClick(newNotif);
          }
          // Chiudi la notifica
          notif.close();
          // Porta la finestra in primo piano
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
      // We don't throw here to avoid crashing the UI for a simple read mark
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (error) {
      console.error('Error deleting notification:', error);
      // We don't throw here to avoid crashing the UI for a simple delete
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
            <span className="text-xs text-gray-400">{unreadCount} non lette</span>
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
                      markAsRead(n.id!);
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
                          onClick={() => deleteNotification(n.id!)}
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
