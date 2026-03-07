import React, { useState, useEffect, useRef } from 'react';
import { Search, Mic, Download, Music, Video, Loader2, Radio, Wifi, WifiOff, UploadCloud, ArrowLeft, VolumeX, Volume2, MessageSquare } from 'lucide-react';
import { FeedbackModal } from './components/FeedbackModal';

interface SearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  url: string;
}

interface VideoFormat {
  itag: number;
  qualityLabel: string;
  bitrate: number;
  mimeType: string;
  hasVideo: boolean;
  hasAudio: boolean;
  contentLength: string;
  url: string;
}

interface VideoDetails extends SearchResult {
  audioFormats: VideoFormat[];
  videoFormats: VideoFormat[];
}

export default function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [musicInfo, setMusicInfo] = useState<any>(null);
  const [isAutoRecognize, setIsAutoRecognize] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isDragging, setIsDragging] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [showAuthError, setShowAuthError] = useState(false);
  const [isUploadingCookies, setIsUploadingCookies] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const suggestTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoRecognizeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastRecognizedRef = useRef<string | null>(null);
  const cooldownRef = useRef<boolean>(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (query.trim() === '') {
      setSuggestions([]);
      return;
    }

    if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
    
    suggestTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSuggestions(data);
      } catch (e) {
        console.error('Failed to fetch suggestions', e);
      }
    }, 300);

    return () => {
      if (suggestTimeoutRef.current) clearTimeout(suggestTimeoutRef.current);
    };
  }, [query]);

  const handleSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setShowSuggestions(false);
    setMusicInfo(null);
    setSelectedVideo(null);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) {
        const text = await res.text();
        console.error('Search API error:', text);
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      setResults(data);
    } catch (e) {
      console.error('Search failed', e);
      alert('Failed to search YouTube. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleVideoClick = async (url: string) => {
    setIsLoadingDetails(true);
    setSelectedVideo(null);
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelectedVideo(data);
    } catch (e: any) {
      console.error('Failed to fetch video details', e);
      const errorMsg = e.message || 'Failed to fetch video details.';
      if (errorMsg.includes('Authentication required') || errorMsg.includes('Sign in to confirm')) {
        setShowAuthError(true);
      } else {
        alert(errorMsg);
      }
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleRecognizeMusic = async () => {
    try {
      setStatus('Listening');
      // Use getDisplayMedia to capture system audio (user must select "Share audio" in the prompt)
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true, 
        audio: true 
      });
      
      // Check if audio track exists
      if (stream.getAudioTracks().length === 0) {
        alert('No audio track found. Please make sure to check "Share audio" when selecting the screen/tab.');
        stream.getTracks().forEach(track => track.stop());
        setStatus('Idle');
        return;
      }

      // We only need the audio track for recording
      const audioStream = new MediaStream([stream.getAudioTracks()[0]]);
      const mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setStatus('Recognizing');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'systemaudio.wav'); // Saving as systemaudio.wav as requested

        try {
          setIsSearching(true);
          const res = await fetch('/api/recognize', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          
          if (data.error) {
            alert(data.error);
            setStatus('Idle');
            return;
          }

          if (data.result) {
            setMusicInfo(data.result);
            setStatus('Detected');
            // Also search YouTube for this song
            handleSearch(`${data.result.title} ${data.result.artist}`);
          } else {
            setStatus('Idle');
            alert('No music recognized.');
          }
        } catch (e) {
          console.error('Recognition failed', e);
          setStatus('Idle');
          alert('Failed to recognize music.');
        } finally {
          setIsSearching(false);
          stream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Record for 10 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 10000);
    } catch (e) {
      console.error('System audio access denied', e);
      setStatus('Idle');
      alert('System audio access is required for music recognition. Please select a screen/tab and check "Share audio".');
    }
  };

  const toggleAutoRecognize = async () => {
    if (isAutoRecognize) {
      setIsAutoRecognize(false);
      setStatus('Idle');
      if (autoRecognizeIntervalRef.current) clearInterval(autoRecognizeIntervalRef.current);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (stream.getAudioTracks().length === 0) {
        alert('No audio track found. Please share audio.');
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      setIsAutoRecognize(true);
      setStatus('Listening');

      const audioStream = new MediaStream([stream.getAudioTracks()[0]]);
      
      const recordAndRecognize = () => {
        if (cooldownRef.current || !isAutoRecognize) return;
        
        const mediaRecorder = new MediaRecorder(audioStream);
        const chunks: BlobPart[] = [];
        
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          if (cooldownRef.current) return;
          setStatus('Recognizing');
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, 'systemaudio.wav');
          
          try {
            const res = await fetch('/api/recognize', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.result && data.result.title !== lastRecognizedRef.current) {
              setMusicInfo(data.result);
              lastRecognizedRef.current = data.result.title;
              setStatus('Detected');
              handleSearch(`${data.result.title} ${data.result.artist}`);
              
              // Cooldown
              cooldownRef.current = true;
              setTimeout(() => { cooldownRef.current = false; setStatus('Listening'); }, 30000);
            } else {
              setStatus('Listening');
            }
          } catch (e) {
            setStatus('Listening');
          }
        };
        
        mediaRecorder.start();
        setTimeout(() => {
          if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, 3000);
      };

      recordAndRecognize();
      autoRecognizeIntervalRef.current = setInterval(recordAndRecognize, 4000);

      stream.getVideoTracks()[0].onended = () => {
        setIsAutoRecognize(false);
        setStatus('Idle');
        if (autoRecognizeIntervalRef.current) clearInterval(autoRecognizeIntervalRef.current);
      };

    } catch (e) {
      console.error(e);
      alert('Failed to start auto recognize.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        setStatus('Recognizing');
        const formData = new FormData();
        formData.append('audio', file);
        try {
          const res = await fetch('/api/recognize', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.result) {
            setMusicInfo(data.result);
            setStatus('Detected');
            handleSearch(`${data.result.title} ${data.result.artist}`);
          } else {
            setStatus('Idle');
            alert('No music recognized from file.');
          }
        } catch (err) {
          setStatus('Idle');
        }
      }
    } else {
      const text = e.dataTransfer.getData('text');
      if (text) {
        setQuery(text);
        handleSearch(text);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleDownload = (url: string, type: 'video' | 'audio', itag?: number) => {
    let downloadUrl = `/api/download?url=${encodeURIComponent(url)}&type=${type}`;
    if (itag) {
      downloadUrl += `&itag=${itag}`;
    }
    window.location.href = downloadUrl;
  };

  return (
    <div 
      className={`min-h-screen bg-gradient-to-br from-emerald-950 via-zinc-950 to-emerald-900 text-emerald-50 font-sans p-6 transition-colors ${isDragging ? 'ring-4 ring-emerald-500 ring-inset bg-emerald-900/20' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm pointer-events-none">
          <div className="text-center text-emerald-400 animate-pulse">
            <UploadCloud className="w-24 h-24 mx-auto mb-4" />
            <h2 className="text-3xl font-bold">Drop Audio File or URL</h2>
          </div>
        </div>
      )}
      
      <div className="max-w-4xl mx-auto space-y-8 relative z-10">
        {/* Header */}
        <div className="relative text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold text-emerald-400 flex items-center justify-center gap-3 pt-2 sm:pt-0">
            <Download className="w-8 h-8 sm:w-10 sm:h-10" />
            FK Downloader
          </h1>
          <p className="text-sm sm:text-base text-emerald-200/60">Search, download, and recognize music instantly.</p>
          
          {/* Status Indicators */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mt-4 text-xs sm:text-sm font-medium">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${isOffline ? 'bg-red-900/30 border-red-500/50 text-red-400' : 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400'}`}>
              {isOffline ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              {isOffline ? 'Offline Mode' : 'Online Mode'}
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border bg-zinc-900/50 border-emerald-800/50 text-emerald-300">
              <Radio className={`w-4 h-4 ${status === 'Listening' || status === 'Recognizing' ? 'animate-pulse text-emerald-400' : ''}`} />
              Status: {status}
            </div>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                id="txtSearch"
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                placeholder="Paste YouTube URL or search for a video..."
                className="w-full bg-zinc-900 border border-emerald-800/50 rounded-xl px-4 py-3 pl-11 text-emerald-100 placeholder-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm sm:text-base"
              />
              <Search className="absolute left-4 top-3.5 w-5 h-5 text-emerald-600" />
              
              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <ul id="lstSuggestions" className="absolute w-full mt-2 bg-zinc-900 border border-emerald-800/50 rounded-xl overflow-hidden shadow-2xl z-50">
                  {suggestions.map((s, i) => (
                    <li
                      key={i}
                      onClick={() => {
                        setQuery(s);
                        handleSearch(s);
                      }}
                      className="px-4 py-2 hover:bg-emerald-900/40 cursor-pointer text-emerald-200 transition-colors text-sm sm:text-base"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => handleSearch()}
                disabled={isSearching}
                className="flex-1 sm:flex-none justify-center bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold px-6 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 text-sm sm:text-base"
              >
                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
              </button>

              <button
                id="btnRecognizeMusic"
                onClick={handleRecognizeMusic}
                disabled={isRecording || isSearching || isAutoRecognize}
                className={`flex-1 sm:flex-none justify-center px-6 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 text-sm sm:text-base ${
                  isRecording 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse' 
                    : 'bg-zinc-900 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/30'
                }`}
              >
                {isRecording ? (
                  <>
                    <Music className="w-5 h-5 animate-bounce" />
                    <span className="hidden sm:inline">Recording (10s)...</span>
                    <span className="sm:hidden">Rec...</span>
                  </>
                ) : (
                  <>
                    <Music className="w-5 h-5" />
                    Recognize
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Music Info Result */}
        {musicInfo && !selectedVideo && (
          <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 text-center sm:text-left">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-zinc-900 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
              {musicInfo.spotify?.album?.images?.[0]?.url ? (
                <img src={musicInfo.spotify.album.images[0].url} alt="Album Art" className="w-full h-full object-cover" />
              ) : (
                <Music className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-600" />
              )}
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-emerald-300">{musicInfo.title}</h2>
              <p className="text-emerald-500 text-base sm:text-lg">{musicInfo.artist}</p>
              {musicInfo.album && <p className="text-emerald-700 text-xs sm:text-sm mt-1">Album: {musicInfo.album}</p>}
            </div>
          </div>
        )}

        {isLoadingDetails && (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
          </div>
        )}

        {/* Detailed Video View */}
        {selectedVideo && !isLoadingDetails && (
          <div className="space-y-6">
            <button 
              onClick={() => setSelectedVideo(null)}
              className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to results
            </button>
            
            <div className="bg-zinc-900/50 border border-emerald-800/30 rounded-2xl overflow-hidden flex flex-col md:flex-row">
              {/* Left Side: Formats Table */}
              <div className="flex-1 p-0 border-b md:border-b-0 md:border-r border-emerald-800/30">
                <div className="bg-zinc-900/80 px-4 py-3 border-b border-emerald-800/30 flex items-center gap-2 font-semibold text-emerald-300">
                  <Music className="w-4 h-4" /> Audio
                </div>
                <div className="divide-y divide-emerald-800/20">
                  {selectedVideo.audioFormats.slice(0, 3).map((format) => (
                    <div key={format.itag} className="flex items-center justify-between p-4 hover:bg-zinc-800/30 transition-colors">
                      <div className="text-sm font-medium text-emerald-100 w-24">MP3 / WebM</div>
                      <div className="text-sm text-emerald-500 w-20 text-center">{format.contentLength}</div>
                      <button
                        onClick={() => handleDownload(selectedVideo.url, 'audio', format.itag)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                      >
                        <Download className="w-4 h-4" /> Download
                      </button>
                    </div>
                  ))}
                </div>

                <div className="bg-zinc-900/80 px-4 py-3 border-y border-emerald-800/30 flex items-center gap-2 font-semibold text-emerald-300 mt-4">
                  <Video className="w-4 h-4" /> Video
                </div>
                <div className="divide-y divide-emerald-800/20">
                  {selectedVideo.videoFormats.slice(0, 8).map((format) => (
                    <div key={format.itag} className="flex items-center justify-between p-4 hover:bg-zinc-800/30 transition-colors">
                      <div className="text-sm font-medium text-emerald-100 w-24 flex items-center gap-1">
                        {format.qualityLabel}
                        {!format.hasAudio && <span title="No Audio"><VolumeX className="w-3 h-3 text-red-400" /></span>}
                      </div>
                      <div className="text-sm text-emerald-500 w-20 text-center">{format.contentLength}</div>
                      <button
                        onClick={() => handleDownload(selectedVideo.url, 'video', format.itag)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                      >
                        <Download className="w-4 h-4" /> Download
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Side: Video Info */}
              <div className="w-full md:w-80 p-6 bg-zinc-950/50 flex flex-col items-center text-center">
                <div className="w-full bg-black rounded-xl overflow-hidden mb-4 shadow-lg border border-zinc-800/50">
                  <img src={selectedVideo.thumbnail} alt={selectedVideo.title} className="w-full h-auto object-contain" />
                </div>
                <h2 className="font-bold text-emerald-100 mb-2">{selectedVideo.title}</h2>
                <p className="text-sm text-emerald-500 font-medium mb-1">{selectedVideo.channel}</p>
                <p className="text-xs text-emerald-700 font-mono">Duration: {formatDuration(selectedVideo.duration)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Results FlowLayoutPanel */}
        {!selectedVideo && !isLoadingDetails && (
          <div id="pnlResults" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((result) => (
              <div 
                key={result.id} 
                onClick={() => handleVideoClick(result.url)}
                className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden hover:border-emerald-500/50 transition-all group flex flex-col cursor-pointer hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] hover:-translate-y-1"
              >
                <div className="relative aspect-video bg-zinc-950">
                  <img
                    id="picThumbnail"
                    src={result.thumbnail}
                    alt={result.title}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="absolute bottom-2 right-2 bg-black/80 text-emerald-400 text-xs px-2 py-1 rounded-md font-mono">
                    {formatDuration(result.duration)}
                  </div>
                </div>
                
                <div className="p-4 flex-1 flex flex-col">
                  <h3 id="lblTitle" className="font-semibold text-emerald-100 line-clamp-2 mb-1 group-hover:text-emerald-300 transition-colors" title={result.title}>
                    {result.title}
                  </h3>
                  <p id="lblChannel" className="text-sm text-emerald-600/80 mb-2 flex-1">
                    {result.channel}
                  </p>
                  <div className="text-xs text-emerald-500/50 font-medium mt-auto">Click to view download options</div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {results.length === 0 && !isSearching && !musicInfo && !isLoadingDetails && (
          <div className="text-center py-20 text-emerald-800/50">
            <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p>Search for a video or recognize a song to get started.</p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-12 pb-6 flex flex-col items-center justify-center gap-4 border-t border-emerald-900/30">
          <button
            id="btnAutoRecognize"
            onClick={toggleAutoRecognize}
            className={`px-6 py-3 w-full sm:w-auto justify-center rounded-xl font-semibold transition-all flex items-center gap-2 ${
              isAutoRecognize 
                ? 'bg-emerald-600 text-zinc-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]' 
                : 'bg-zinc-900 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/30'
            }`}
          >
            <Radio className={`w-5 h-5 ${isAutoRecognize ? 'animate-pulse' : ''}`} />
            Auto-Recognize
          </button>
        </div>
      </div>

      {/* Feedback Button */}
      <button
        onClick={() => setIsFeedbackOpen(true)}
        className="fixed bottom-6 right-6 bg-indigo-500 hover:bg-indigo-600 text-white p-3 rounded-full shadow-lg hover:shadow-indigo-500/25 transition-all hover:-translate-y-1 z-40 group flex items-center gap-2"
        aria-label="Send Feedback"
      >
        <MessageSquare className="w-6 h-6" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap font-medium">
          Feedback
        </span>
      </button>

      <FeedbackModal 
        isOpen={isFeedbackOpen} 
        onClose={() => setIsFeedbackOpen(false)} 
      />

      {/* Auth Error Modal */}
      {showAuthError && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-900/50 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
              Authentication Required
            </h2>
            <p className="text-zinc-300 mb-4 text-sm leading-relaxed">
              YouTube requires authentication to fetch this video. Please provide a valid <code className="bg-zinc-800 px-1 py-0.5 rounded text-emerald-400">cookies.txt</code> file exported from your browser.
            </p>
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 mb-6">
              <ol className="list-decimal list-inside text-xs text-zinc-400 space-y-2">
                <li>Install the <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/ccmclabmhdpegeebcfncaggjjdbceaoi" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Get cookies.txt locally</a> extension</li>
                <li>Go to YouTube and make sure you are logged in</li>
                <li>Click the extension icon and export the cookies</li>
                <li>Upload the resulting <code className="text-emerald-400">youtube.com_cookies.txt</code> file below</li>
              </ol>
            </div>
            
            <div className="flex flex-col gap-3">
              <label className="relative flex items-center justify-center w-full p-4 border-2 border-dashed border-emerald-900/50 rounded-xl hover:bg-emerald-900/20 hover:border-emerald-500/50 transition-colors cursor-pointer group">
                <input 
                  type="file" 
                  accept=".txt" 
                  className="hidden" 
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    setIsUploadingCookies(true);
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    try {
                      const res = await fetch('/api/cookies', {
                        method: 'POST',
                        body: formData
                      });
                      if (!res.ok) throw new Error('Failed to upload cookies');
                      setShowAuthError(false);
                      alert('Cookies uploaded successfully! Please try downloading again.');
                    } catch (err) {
                      alert('Failed to upload cookies. Please try again.');
                    } finally {
                      setIsUploadingCookies(false);
                    }
                  }}
                />
                <div className="flex items-center gap-2 text-emerald-500 group-hover:text-emerald-400">
                  {isUploadingCookies ? <Loader2 className="w-5 h-5 animate-spin" /> : <UploadCloud className="w-5 h-5" />}
                  <span className="font-medium text-sm">
                    {isUploadingCookies ? 'Uploading...' : 'Upload cookies.txt'}
                  </span>
                </div>
              </label>
              
              <button 
                onClick={() => setShowAuthError(false)}
                className="w-full py-3 rounded-xl font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

