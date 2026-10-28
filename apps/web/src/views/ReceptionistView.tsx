import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  Bot,
  MessageSquare,
  Sliders,
  CheckCircle,
  Clock,
  User,
  Save,
  RefreshCw,
  AlertCircle,
  Send,
  Archive,
  Radio,
  Trash2,
} from 'lucide-react';
import { WhatsAppIntegrationSettings } from '../components/WhatsAppIntegrationSettings';
import { DeleteConversationModal } from '../components/modals/DeleteConversationModal';

export type ReceptionistTab = 'chats' | 'settings' | 'integration';

interface ReceptionistViewProps {
  onOpenHandoffModal: (handoff: any) => void;
  initialTab?: ReceptionistTab;
  initialConversationId?: string;
  onConversationSelect?: (id: string) => void;
}

export const ReceptionistView: React.FC<ReceptionistViewProps> = ({
  onOpenHandoffModal,
  initialTab,
  initialConversationId,
  onConversationSelect,
}) => {
  const toast = useToast();
  const { formatTime } = useClinic();
  const [activeTab, setActiveTab] = useState<ReceptionistTab>(initialTab || 'chats');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Chats state
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId || null);
  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Message reply composer state
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [resolveHandoffOnSend, setResolveHandoffOnSend] = useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const lastSyncTimestampRef = React.useRef<string>(new Date().toISOString());

  // Track selectedConversationId in ref to prevent stale closures and effect churn
  const selectedConversationIdRef = React.useRef<string | null>(selectedConversationId);
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  // Delete conversation confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<any | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  // Settings state
  const [settings, setSettings] = useState<any>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Notify parent of conversation selection for route synchronization
  useEffect(() => {
    if (onConversationSelect) {
      onConversationSelect(selectedConversationId || '');
    }
  }, [selectedConversationId, onConversationSelect]);

  // Load conversations
  const loadConversations = useCallback(async (preserveId?: string, silent?: boolean) => {
    try {
      if (!silent) setLoadingConversations(true);
      const res = await api.getConversations({ pageSize: 40 });
      setConversations(res.items || []);
      const currentSelected = selectedConversationIdRef.current;
      const targetId = preserveId || currentSelected || initialConversationId;
      if (targetId && res.items?.some((c: any) => c.id === targetId)) {
        if (targetId !== currentSelected) {
          setSelectedConversationId(targetId);
        }
      } else if (res.items && res.items.length > 0 && !currentSelected) {
        setSelectedConversationId(res.items[0].id);
      }
    } catch (err: any) {
      toast.error('Unable to load conversations', err.message);
    } finally {
      if (!silent) setLoadingConversations(false);
    }
  }, [initialConversationId, toast]);

  // Load selected chat messages
  const loadChat = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const res = await api.getConversation(id);
      setSelectedChat(res);
      lastSyncTimestampRef.current = new Date().toISOString();
    } catch (err: any) {
      toast.error('Unable to load messages', err.message);
    } finally {
      setLoadingMessages(false);
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      setSelectedChat(null);
      return;
    }
    loadChat(selectedConversationId);
  }, [selectedConversationId, loadChat]);

  // Real-time EventSource listener + Delta Sync
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: any = null;
    let isDisposed = false;

    const setupSSE = async () => {
      if (isDisposed) return;
      try {
        const ticket = await api.getStreamTicket();
        if (isDisposed) return;
        const streamUrl = api.getConversationStreamUrl(ticket);
        es = new EventSource(streamUrl);

        es.onopen = () => {
          if (!isDisposed) {
            setRealtimeConnected(true);
          }
        };

        es.addEventListener('message', (e: MessageEvent) => {
          if (isDisposed || !e.data) return;
          try {
            const data = JSON.parse(e.data);
            const { conversationId, message, lastMessageAt, lastMessageBody } = data;
            if (!message) return;

            lastSyncTimestampRef.current = new Date().toISOString();

            // 1. Update conversations list
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === conversationId);
              if (idx === -1) {
                // New conversation arrived: silently refresh list
                loadConversations(selectedConversationIdRef.current || undefined, true);
                return prev;
              }
              const updated = [...prev];
              const conv = { ...updated[idx] };
              conv.lastMessageBody = lastMessageBody || message.body || conv.lastMessageBody;
              conv.lastMessageAt = lastMessageAt || message.createdAt || conv.lastMessageAt;
              conv.messageCount = (conv.messageCount || 0) + 1;
              updated.splice(idx, 1);
              updated.unshift(conv);
              return updated;
            });

            // 2. If it belongs to currently open chat, append without duplicates
            setSelectedChat((prevChat: any) => {
              if (!prevChat) return prevChat;
              const currentChatId = prevChat.id || prevChat.conversation?.id;
              if (currentChatId !== conversationId) return prevChat;

              const currentMsgs = prevChat.messages || prevChat.conversation?.messages || [];
              const exists = currentMsgs.some((m: any) =>
                m.id === message.id ||
                (message.providerMessageId && m.providerMessageId === message.providerMessageId)
              );
              if (exists) return prevChat;

              const updatedMsgs = [...currentMsgs, message];
              return {
                ...prevChat,
                messages: updatedMsgs,
                conversation: {
                  ...(prevChat.conversation || prevChat),
                  messages: updatedMsgs,
                  lastMessageAt: message.createdAt,
                  lastMessageBody: message.body,
                },
              };
            });
          } catch (err) {
            console.warn('Error processing realtime message event:', err);
          }
        });

        es.addEventListener('conversation_deleted', (e: MessageEvent) => {
          if (isDisposed || !e.data) return;
          try {
            const data = JSON.parse(e.data);
            const { conversationId } = data;
            if (!conversationId) return;

            // Immediately clear active chat if it matches the deleted conversation
            setSelectedChat((prevChat: any) => {
              if (!prevChat) return null;
              const currentChatId = prevChat.id || prevChat.conversation?.id;
              if (currentChatId === conversationId) return null;
              return prevChat;
            });

            setConversations((prev) => {
              const remaining = prev.filter((c) => c.id !== conversationId);
              if (selectedConversationIdRef.current === conversationId) {
                const nextId = remaining[0]?.id || null;
                selectedConversationIdRef.current = nextId;
                setSelectedConversationId(nextId);
              }
              return remaining;
            });
          } catch (err) {
            console.warn('Error processing conversation_deleted event:', err);
          }
        });

        es.onerror = () => {
          if (isDisposed) return;
          setRealtimeConnected(false);
          es?.close();
          reconnectTimer = setTimeout(setupSSE, 4000);
        };
      } catch {
        setRealtimeConnected(false);
        reconnectTimer = setTimeout(setupSSE, 5000);
      }
    };

    setupSSE();

    // Tab visibility recovery handler: catch up on any missed messages
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !isDisposed) {
        try {
          const currentSelected = selectedConversationIdRef.current;
          const syncRes = await api.syncConversations(lastSyncTimestampRef.current, currentSelected || undefined);
          if (syncRes.messages && syncRes.messages.length > 0) {
            lastSyncTimestampRef.current = syncRes.serverTime || new Date().toISOString();
            syncRes.messages.forEach((msg) => {
              setSelectedChat((prevChat: any) => {
                if (!prevChat) return prevChat;
                const currentChatId = prevChat.id || prevChat.conversation?.id;
                if (currentChatId !== msg.conversationId) return prevChat;
                const currentMsgs = prevChat.messages || prevChat.conversation?.messages || [];
                if (currentMsgs.some((m: any) => m.id === msg.id || (msg.providerMessageId && m.providerMessageId === msg.providerMessageId))) return prevChat;
                return {
                  ...prevChat,
                  messages: [...currentMsgs, msg],
                };
              });
            });
            loadConversations(currentSelected || undefined, true);
          }
        } catch {
          // ignore transient sync error
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isDisposed = true;
      if (es) es.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadConversations]);

  // Scroll messages to bottom when chat loads or message sent
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedChat]);

  // Send staff reply to the patient
  const handleSendReply = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!selectedConversationId || !replyText.trim() || sendingReply) return;

    const trimmed = replyText.trim();
    setSendingReply(true);
    try {
      const res = await api.sendMessage(selectedConversationId, trimmed, resolveHandoffOnSend);
      toast.success(
        'Reply Sent',
        res.deliveryStatus === 'sent'
          ? 'Message delivered to patient via WhatsApp.'
          : 'Reply recorded in conversation transcript.'
      );
      setReplyText('');
      setResolveHandoffOnSend(false);

      // Append new message to transcript immediately with deduplication
      setSelectedChat((prevChat: any) => {
        if (!prevChat) return prevChat;
        const currentChatId = prevChat.id || prevChat.conversation?.id;
        if (currentChatId !== selectedConversationId) return prevChat;

        const currentMsgs = prevChat.messages || prevChat.conversation?.messages || [];
        const exists = currentMsgs.some((m: any) =>
          m.id === res.id ||
          (res.providerMessageId && m.providerMessageId === res.providerMessageId)
        );
        if (exists) return prevChat;

        const updatedMsgs = [...currentMsgs, res];
        return {
          ...prevChat,
          messages: updatedMsgs,
          conversation: {
            ...(prevChat.conversation || prevChat),
            messages: updatedMsgs,
            lastMessageAt: res.createdAt,
            lastMessageBody: res.body,
          },
        };
      });

      // Update conversations list in-place immediately without triggering a full loading reload
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === selectedConversationId);
        if (idx === -1) return prev;
        const updated = [...prev];
        const conv = { ...updated[idx] };
        conv.lastMessageBody = trimmed;
        conv.lastMessageAt = res.createdAt || new Date().toISOString();
        conv.messageCount = (conv.messageCount || 0) + 1;
        if (resolveHandoffOnSend) {
          conv.handoffStatus = 'resolved';
          conv.state = 'active';
        }
        updated.splice(idx, 1);
        updated.unshift(conv);
        return updated;
      });
    } catch (err: any) {
      toast.error('Send Failed', err.message || 'Unable to send message reply.');
    } finally {
      setSendingReply(false);
    }
  };

  const handleOpenDeleteModal = (conv: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setConversationToDelete(conv);
    setDeleteModalOpen(true);
  };

  const handleConfirmDeleteConversation = async () => {
    if (!conversationToDelete || isDeletingConversation) return;
    const targetId = conversationToDelete.id;
    setIsDeletingConversation(true);
    try {
      await api.deleteConversation(targetId);
      toast.success('Conversation Deleted', 'The conversation thread has been permanently removed.');

      // Immediately clear active chat if it matches the deleted conversation
      setSelectedChat((prevChat: any) => {
        if (!prevChat) return null;
        const currentChatId = prevChat.id || prevChat.conversation?.id;
        if (currentChatId === targetId) return null;
        return prevChat;
      });

      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== targetId);
        if (selectedConversationIdRef.current === targetId) {
          const nextId = remaining[0]?.id || null;
          selectedConversationIdRef.current = nextId;
          setSelectedConversationId(nextId);
        }
        return remaining;
      });

      setDeleteModalOpen(false);
      setConversationToDelete(null);
    } catch (err: any) {
      toast.error('Deletion Failed', err.message || 'Unable to delete conversation.');
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const handleCloseConversation = async (conversationId: string) => {
    try {
      await api.closeConversation(conversationId, 'staff_manual_close');
      toast.success('Conversation Closed', 'This conversation thread has been archived. A future patient message will begin a new thread according to policy.');
      loadConversations(conversationId, true);
      loadChat(conversationId);
    } catch (err: any) {
      toast.error('Close Failed', err.message || 'Unable to close conversation.');
    }
  };

  // Load settings when tab opens
  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await api.getReceptionistSettings();
      setSettings(res);
    } catch (err: any) {
      toast.error('Unable to load receptionist preferences', err.message);
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'chats') {
      loadConversations();
    } else if (activeTab === 'settings') {
      loadSettings();
    }
  }, [activeTab]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      setSavingSettings(true);
      await api.updateReceptionistSettings(settings);
      toast.success('Preferences Saved', 'AI receptionist instructions and policies updated successfully.');
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1, minHeight: 0, height: '100%', width: '100%' }}>
      {/* Sub-Tabs Selector */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '10px',
          flexShrink: 0,
          width: '100%',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => setActiveTab('chats')}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: activeTab === 'chats' ? 'var(--accent-subtle)' : 'transparent',
            border: activeTab === 'chats' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            color: activeTab === 'chats' ? 'var(--accent-text)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '12.5px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <MessageSquare size={14} /> Patient Conversations & Inbox
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: activeTab === 'settings' ? 'var(--accent-subtle)' : 'transparent',
            border: activeTab === 'settings' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            color: activeTab === 'settings' ? 'var(--accent-text)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '12.5px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <Sliders size={14} /> Receptionist Preferences & Behavior
        </button>
        <button
          id="tab-whatsapp-integration"
          onClick={() => setActiveTab('integration')}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: activeTab === 'integration' ? 'var(--accent-subtle)' : 'transparent',
            border: activeTab === 'integration' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            color: activeTab === 'integration' ? 'var(--accent-text)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '12.5px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <Radio size={14} /> WhatsApp Cloud API Integration
        </button>
      </div>

      {activeTab === 'chats' ? (
        /* Dual-pane Patient Conversations View */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 320px) 1fr',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            flex: 1,
            minHeight: 0,
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Left: Conversations List */}
          <div
            style={{
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <h3 style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Patient Conversations ({conversations.length})
              </h3>
              <button
                onClick={() => loadConversations()}
                title="Refresh Conversations"
                aria-label="Refresh Conversations"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '3px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <RefreshCw size={13} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {loadingConversations ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  Loading patient conversations...
                </div>
              ) : conversations.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  No active conversations found.
                </div>
              ) : (
                conversations.map((c) => {
                  const isSelected = c.id === selectedConversationId;
                  const needsAttention = c.handoffStatus === 'pending' || c.state === 'escalated';
                  const patientName = c.patientName || c.contactName || c.patient?.name || (c.patientPhone || c.contactPhone || c.phone) || 'Unknown contact';

                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelectedConversationId(c.id)}
                      style={{
                        padding: '9px 12px',
                        borderBottom: '1px solid var(--border-subtle)',
                        backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                        borderLeft: isSelected ? '3px solid var(--accent-primary)' : '3px solid transparent',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '12.5px' }}>
                          {patientName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                            {formatTime(c.lastActivity || c.lastMessageAt || c.updatedAt || c.createdAt)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleOpenDeleteModal(c, e)}
                            title="Delete conversation permanently"
                            aria-label={`Delete conversation with ${patientName}`}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 1,
                              transition: 'color 0.15s ease, background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--danger)';
                              e.currentTarget.style.backgroundColor = 'var(--danger-subtle)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--text-muted)';
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {c.patientPhone || c.contactPhone || c.phone || ''}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        {needsAttention ? (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 600,
                              color: 'var(--warning)',
                              backgroundColor: 'var(--warning-subtle)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(194, 91, 16, 0.2)',
                            }}
                          >
                            Needs Staff Attention
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 500,
                              color: 'var(--success)',
                              backgroundColor: 'var(--success-subtle)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(46, 125, 50, 0.2)',
                            }}
                          >
                            AI Handled
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {c.messageCount || 0} messages
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Message Transcript Viewer */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            {selectedChat ? (() => {
              const conv = selectedChat.conversation || selectedChat;
              const msgs = selectedChat.messages || conv?.messages || [];
              const patientDisplay = conv.patientName || conv.contactName || conv.patient?.name || (conv.patientPhone || conv.contactPhone || conv.phone) || 'Unknown contact';
              const needsAttention = conv.handoffStatus === 'pending' || conv.state === 'escalated';
              const phoneDisplay = conv.patientPhone || conv.contactPhone || conv.phone || (conv.channel ? `Channel: ${conv.channel}` : 'Direct Contact');

              return (
                <ErrorBoundary name="Conversation Transcript">
                  {/* Header */}
                  <div
                    style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'var(--bg-surface)',
                      flexShrink: 0,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                          {patientDisplay}
                        </h3>
                        {conv.closedAt ? (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              color: 'var(--text-muted)',
                              backgroundColor: 'var(--bg-app)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            Resolved & Archived
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              color: 'var(--success)',
                              backgroundColor: 'var(--success-subtle)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(46, 125, 50, 0.2)',
                            }}
                          >
                            Active Thread
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                        {phoneDisplay} • {conv.closedAt ? 'Historical record preserved' : 'Live receptionist thread'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenDeleteModal(conv)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          fontSize: '12px',
                          color: 'var(--danger)',
                          borderColor: 'rgba(239, 68, 68, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                        title="Permanently delete this conversation from PostgreSQL"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                      {!conv.closedAt && (
                        <button
                          onClick={() => handleCloseConversation(conv.id)}
                          className="btn btn-secondary btn-sm"
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            fontSize: '12px',
                          }}
                          title="Archive this conversation thread. If the patient messages again, a new thread will be created."
                        >
                          <Archive size={13} /> Close Thread
                        </button>
                      )}
                      {needsAttention && (
                        <button
                          onClick={() =>
                            onOpenHandoffModal({
                              id: conv.handoffId || conv.id,
                              patientName: patientDisplay,
                              patientPhone: conv.patientPhone || conv.contactPhone || conv.phone,
                              reason: conv.handoffReason || 'Staff Attention Requested',
                            })
                          }
                          className="btn btn-primary btn-sm"
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            fontSize: '12px',
                          }}
                        >
                          <CheckCircle size={13} /> Attend Enquiry
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Messages Transcript Scroll */}
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      padding: '14px 18px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      backgroundColor: 'var(--bg-app)',
                    }}
                  >
                    {loadingMessages ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                        Loading message history...
                      </div>
                    ) : msgs.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                        No messages recorded in this conversation yet.
                      </div>
                    ) : (
                      msgs.map((m: any, idx: number) => {
                        const isOutbound = m.direction === 'outbound' || m.role === 'assistant';
                        const isStaff =
                          isOutbound &&
                          (m.provider_message_id?.startsWith('staff_reply:') ||
                            m.provider_payload?.sentBy === 'clinic_staff' ||
                            m.deliveryStatus === 'logged_locally');

                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: isOutbound ? 'flex-end' : 'flex-start',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                                marginBottom: '3px',
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {isOutbound ? (
                                isStaff ? (
                                  <>
                                    <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>Clinic Staff</span>
                                    <User size={11} color="var(--accent-primary)" />
                                  </>
                                ) : (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Dental AI Receptionist</span>
                                    <Bot size={11} color="var(--accent-primary)" />
                                  </>
                                )
                              ) : (
                                <>
                                  <User size={11} color="var(--text-secondary)" />
                                  <span style={{ color: 'var(--text-secondary)' }}>{patientDisplay}</span>
                                </>
                              )}
                              <span>
                                • {formatTime(m.createdAt || m.created_at || Date.now())}
                              </span>
                            </div>

                            <div
                              style={{
                                maxWidth: '75%',
                                padding: '8px 12px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: isOutbound
                                  ? isStaff
                                    ? 'var(--accent-primary)'
                                    : 'var(--accent-subtle)'
                                  : 'var(--bg-surface)',
                                color: isOutbound && isStaff
                                  ? '#ffffff'
                                  : 'var(--text-primary)',
                                fontSize: '13px',
                                lineHeight: '1.45',
                                border: isOutbound && isStaff
                                  ? 'none'
                                  : '1px solid var(--border-card)',
                                boxShadow: 'var(--shadow-sm)',
                              }}
                            >
                              {m.body || m.content}
                            </div>

                            {/* Delivery Status Indicator */}
                            {isOutbound && (
                              <div
                                style={{
                                  fontSize: '10.5px',
                                  color: 'var(--text-muted)',
                                  marginTop: '2px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {m.deliveryStatus === 'sent' ? (
                                  <>
                                    <CheckCircle size={10} color="var(--success)" />
                                    <span>Sent to WhatsApp</span>
                                  </>
                                ) : m.deliveryStatus === 'failed' ? (
                                  <>
                                    <AlertCircle size={10} color="var(--danger)" />
                                    <span>Delivery failed</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle size={10} color="var(--accent-primary)" />
                                    <span>Recorded in chart</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Composer */}
                  <div
                    role="region"
                    aria-label="Message Composer"
                    style={{
                      flexShrink: 0,
                      padding: '10px 16px',
                      borderTop: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-surface)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendReply();
                          }
                        }}
                        disabled={sendingReply}
                        rows={2}
                        placeholder={`Reply to ${patientDisplay}... (Press Enter to send, Shift+Enter for new line)`}
                        className="form-input"
                        style={{
                          flex: 1,
                          resize: 'none',
                          fontSize: '12.5px',
                          lineHeight: '1.4',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleSendReply}
                        disabled={sendingReply || !replyText.trim()}
                        className="btn btn-primary"
                        style={{
                          height: '34px',
                          padding: '0 14px',
                          fontSize: '12.5px',
                        }}
                      >
                        <Send size={13} />
                        {sendingReply ? 'Sending...' : 'Send'}
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {needsAttention && (
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={resolveHandoffOnSend}
                              onChange={(e) => setResolveHandoffOnSend(e.target.checked)}
                              style={{ width: '13px', height: '13px', accentColor: 'var(--accent-primary)' }}
                            />
                            Resolve staff handoff with this message
                          </label>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>
                          Safe test mode: Replies recorded in patient chart (Live WhatsApp dispatch uses configured credentials)
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab('integration')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--accent-primary)',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                          }}
                        >
                          Configure WhatsApp
                        </button>
                      </div>
                    </div>
                  </div>
                </ErrorBoundary>
              );
            })() : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '13.5px',
                  backgroundColor: 'var(--bg-app)',
                }}
              >
                Select a patient conversation to inspect messages
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'settings' ? (
        /* Receptionist Behavior & Preferences Form */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', width: '100%' }}>
          <form
            onSubmit={handleSaveSettings}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {loadingSettings ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading receptionist preferences...</div>
            ) : settings ? (
              <>
                {/* Automated Answering Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Automated Receptionist Answering
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      When paused, incoming patient WhatsApp enquiries will be directed to human staff.
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                      style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)' }}
                    />
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: settings.enabled ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      {settings.enabled ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </label>
                </div>

                {/* Welcome Message */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Welcome Greeting Message
                  </label>
                  <textarea
                    rows={3}
                    value={settings.greetingMessage || ''}
                    onChange={(e) => setSettings({ ...settings, greetingMessage: e.target.value })}
                    placeholder="e.g. Hello! Welcome to our dental practice. How can I assist you with appointments or dental care today?"
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px', lineHeight: '1.45', padding: '8px 12px' }}
                  />
                </div>

                {/* Tone & Emergency Phone */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      Conversation Tone
                    </label>
                    <select
                      value={settings.tone || 'professional'}
                      onChange={(e) => setSettings({ ...settings, tone: e.target.value })}
                      className="form-input"
                      style={{ width: '100%', fontSize: '13px', height: '34px' }}
                    >
                      <option value="professional">Professional & Welcoming</option>
                      <option value="empathetic">Empathetic & Gentle (Anxious Patients)</option>
                      <option value="concise">Brief & Direct</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      Urgent / Emergency Contact Phone
                    </label>
                    <input
                      type="text"
                      value={settings.emergencyPhone || ''}
                      onChange={(e) => setSettings({ ...settings, emergencyPhone: e.target.value })}
                      placeholder="+1 (555) 123-4567"
                      className="form-input"
                      style={{ width: '100%', fontSize: '13px', height: '34px' }}
                    />
                  </div>
                </div>

                {/* Cancellation Policy */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Cancellation & Rescheduling Information Given to Patients
                  </label>
                  <textarea
                    rows={2}
                    value={settings.cancellationPolicy || ''}
                    onChange={(e) => setSettings({ ...settings, cancellationPolicy: e.target.value })}
                    placeholder="e.g. Please provide at least 24 hours notice to change your appointment."
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px', lineHeight: '1.45', padding: '8px 12px' }}
                  />
                </div>

                {/* Accepted Insurance Plans */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Accepted Dental Insurance Information
                  </label>
                  <textarea
                    rows={2}
                    value={settings.acceptedInsurance || ''}
                    onChange={(e) => setSettings({ ...settings, acceptedInsurance: e.target.value })}
                    placeholder="e.g. We accept Delta Dental, MetLife, Cigna PPO, and Guardian."
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px', lineHeight: '1.45', padding: '8px 12px' }}
                  />
                </div>

                {/* Save Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="btn btn-primary"
                    style={{
                      height: '32px',
                      padding: '0 16px',
                      fontSize: '13px',
                    }}
                  >
                    <Save size={14} />
                    {savingSettings ? 'Saving...' : 'Save Receptionist Preferences'}
                  </button>
                </div>
              </>
            ) : null}
          </form>
        </div>
      ) : (
        /* Dedicated WhatsApp Cloud API Integration View */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', width: '100%' }}>
          <WhatsAppIntegrationSettings />
        </div>
      )}

      {/* Delete Conversation Confirmation Dialog */}
      <DeleteConversationModal
        isOpen={deleteModalOpen}
        conversation={conversationToDelete}
        onClose={() => {
          if (!isDeletingConversation) {
            setDeleteModalOpen(false);
            setConversationToDelete(null);
          }
        }}
        onConfirm={handleConfirmDeleteConversation}
        isDeleting={isDeletingConversation}
      />
    </div>
  );
};
