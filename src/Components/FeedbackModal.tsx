import React, { useState } from 'react';
import { X, MessageSquare, Bug, Lightbulb, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [type, setType] = useState<'bug' | 'suggestion'>('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Please enter a message');
      return;
    }

    if (!navigator.onLine) {
      setError('Feedback needs an internet connection.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, message, email }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setMessage('');
        setEmail('');
        onClose();
      }, 2000);
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-400" />
                Send Feedback
              </h2>
              <button
                onClick={onClose}
                className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors rounded-lg hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4">
              {isSuccess ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4"
                  >
                    <CheckCircle2 className="w-6 h-6" />
                  </motion.div>
                  <h3 className="text-lg font-medium text-zinc-100 mb-1">Thank you!</h3>
                  <p className="text-zinc-400 text-sm">Your feedback has been received.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex gap-2 p-1 bg-zinc-800/50 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setType('bug')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                        type === 'bug'
                          ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      <Bug className="w-4 h-4" />
                      Report Bug
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('suggestion')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                        type === 'suggestion'
                          ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      <Lightbulb className="w-4 h-4" />
                      Suggestion
                    </button>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-zinc-300 mb-1">
                      {type === 'bug' ? 'What went wrong?' : 'How can we improve?'}
                    </label>
                    <textarea
                      id="message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={4}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      placeholder={type === 'bug' ? 'Describe the issue...' : 'Share your ideas...'}
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1">
                      Email (optional)
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="For follow-up questions"
                    />
                  </div>

                  {error && <p className="text-red-400 text-sm">{error}</p>}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      'Submit Feedback'
                    )}
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
