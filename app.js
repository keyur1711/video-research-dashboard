// ===================================
// VIDEO RESEARCH DASHBOARD
// Rebuilt from scratch - Clean version
// ===================================

// App State
const state = {
    discoveryResults: [],
    selectedVideos: [],
    transcriptionResults: [],
    settings: {
        // Platform API Tokens (separate for each)
        tiktokApiToken: '',
        instagramApiToken: '',
        youtubeApiToken: '',
        
        // Scraper Actor IDs
        tiktokActorId: '',
        instagramActorId: '',
        youtubeActorId: '',
        
        // Transcription
        transcribeToken: '',
        
        // Google Sheets
        sheetId: '',
        sheetName: 'Sheet1'
    }
};

// CORS Proxy for Apify API calls
const CORS_PROXY = 'https://corsproxy.io/?';

// Apify API expects actor ID as username~actor-name (tilde), not slash
function apifyActorId(id) {
    if (!id) return id;
    return id.replace(/\//g, '~');
}

// Parse scraper output to number (handles strings and various field names)
function toNum(val) {
    if (val === undefined || val === null) return 0;
    return Math.max(0, parseInt(String(val), 10) || 0);
}

// Get comment count from scraper item (tries many possible field names)
function getCommentCount(v) {
    const paths = [
        v.commentCount, v.comments, v.comment_count,
        v.stats?.commentCount, v.stats?.comment_count, v.stats?.comments,
        v.statistics?.commentCount, v.statistics?.comment_count,
        v.engagement?.commentCount, v.engagement?.comments,
        v.commentsCount, v.totalCommentCount, v.numComments
    ];
    for (const val of paths) {
        const n = toNum(val);
        if (n > 0) return n;
    }
    // Fallback: find any key containing 'comment' with a numeric value
    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return 0;
        for (const key of Object.keys(obj)) {
            if (/comment/i.test(key) && (typeof obj[key] === 'number' || typeof obj[key] === 'string')) {
                const n = toNum(obj[key]);
                if (n > 0) return n;
            }
            if (typeof obj[key] === 'object' && key !== 'author' && key !== 'authorMeta') {
                const found = walk(obj[key]);
                if (found > 0) return found;
            }
        }
        return 0;
    };
    return walk(v) || 0;
}

function corsfetch(url, options = {}) {
    if (url.includes('api.apify.com')) {
        return fetch(CORS_PROXY + encodeURIComponent(url), options);
    }
    return fetch(url, options);
}

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
});

// ===================================
// SETTINGS MANAGEMENT
// ===================================

function loadSettings() {
    const saved = localStorage.getItem('videoResearchSettings');
    if (saved) {
        state.settings = JSON.parse(saved);
        
        // Load API tokens
        document.getElementById('tiktokApiToken').value = state.settings.tiktokApiToken || '';
        document.getElementById('instagramApiToken').value = state.settings.instagramApiToken || '';
        document.getElementById('youtubeApiToken').value = state.settings.youtubeApiToken || '';
        
        // Load Actor IDs
        document.getElementById('tiktokActorId').value = state.settings.tiktokActorId || '';
        document.getElementById('instagramActorId').value = state.settings.instagramActorId || '';
        document.getElementById('youtubeActorId').value = state.settings.youtubeActorId || '';
        
        // Load other settings
        document.getElementById('transcribeToken').value = state.settings.transcribeToken || '';
        document.getElementById('sheetId').value = state.settings.sheetId || '';
        document.getElementById('sheetName').value = state.settings.sheetName || 'Sheet1';
    }
    updateDiscoveryButtonState();
}

function saveSettings() {
    // Save API tokens
    state.settings.tiktokApiToken = document.getElementById('tiktokApiToken').value;
    state.settings.instagramApiToken = document.getElementById('instagramApiToken').value;
    state.settings.youtubeApiToken = document.getElementById('youtubeApiToken').value;
    
    // Save Actor IDs
    state.settings.tiktokActorId = document.getElementById('tiktokActorId').value;
    state.settings.instagramActorId = document.getElementById('instagramActorId').value;
    state.settings.youtubeActorId = document.getElementById('youtubeActorId').value;
    
    // Save other settings
    state.settings.transcribeToken = document.getElementById('transcribeToken').value;
    state.settings.sheetId = document.getElementById('sheetId').value;
    state.settings.sheetName = document.getElementById('sheetName').value;

    localStorage.setItem('videoResearchSettings', JSON.stringify(state.settings));
    updateDiscoveryButtonState();
    showStatus('settingsStatus', 'Settings saved successfully!', 'success');
}

function clearAllData() {
    if (confirm('Are you sure you want to clear all saved data and settings?')) {
        localStorage.clear();
        state.discoveryResults = [];
        state.selectedVideos = [];
        state.transcriptionResults = [];
        location.reload();
    }
}

function updateDiscoveryButtonState() {
    const searchBtn = document.getElementById('searchVideosBtn');
    if (!searchBtn) return;

    const hasTikTok = !!state.settings.tiktokApiToken;
    const hasInstagram = !!state.settings.instagramApiToken;
    const hasYouTube = !!state.settings.youtubeApiToken;

    if (!hasTikTok && !hasInstagram && !hasYouTube) {
        searchBtn.disabled = true;
        searchBtn.innerText = 'Add API Key in Settings';
        searchBtn.style.opacity = '0.6';
        searchBtn.style.cursor = 'not-allowed';
    } else {
        searchBtn.disabled = false;
        searchBtn.innerText = 'Search Videos';
        searchBtn.style.opacity = '1';
        searchBtn.style.cursor = 'pointer';
    }
}

// ===================================
// TAB SWITCHING
// ===================================

function switchTab(tabName, el) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    el.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}


// ===================================
// VIDEO DISCOVERY
// ===================================

async function startDiscovery() {
    const topic = document.getElementById('searchTopic').value.trim();
    if (!topic) {
        showStatus('discoveryStatus', 'Please enter a topic or hashtag', 'error');
        return;
    }

    const platform = document.getElementById('platformSelect').value;
    const minViews = parseInt(document.getElementById('minViews').value) || 0;
    const minLikes = parseInt(document.getElementById('minLikes').value) || 0;
    const maxResults = parseInt(document.getElementById('maxResults').value) || 50;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    showLoading('discoveryLoading', true);
    const platformsToSearch = [];
    if (platform === 'all' || platform === 'both' || platform === 'tiktok') {
        if (!state.settings.tiktokApiToken) {
            showStatus('discoveryStatus', 'Please add TikTok API token in Settings', 'error');
            showLoading('discoveryLoading', false);
            return;
        }
        platformsToSearch.push('tiktok');
    }
    if (platform === 'all' || platform === 'both' || platform === 'instagram') {
        if (!state.settings.instagramApiToken) {
            showStatus('discoveryStatus', 'Please add Instagram API token in Settings', 'error');
            showLoading('discoveryLoading', false);
            return;
        }
        platformsToSearch.push('instagram');
    }
    if (platform === 'all' || platform === 'youtube') {
        if (!state.settings.youtubeApiToken) {
            showStatus('discoveryStatus', 'Please add YouTube API token in Settings', 'error');
            showLoading('discoveryLoading', false);
            return;
        }
        platformsToSearch.push('youtube');
    }

    const searchLabels = platformsToSearch.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
    showStatus('discoveryStatus', `Searching ${searchLabels} in parallel… (usually 1–3 min; lower "Max Results" = faster)`, 'info');
    const startTime = Date.now();
    const elapsedInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - startTime) / 1000);
        const el = document.getElementById('discoveryStatus');
        if (el && el.querySelector('.status-message')) {
            el.querySelector('.status-message').textContent =
                `Searching ${searchLabels}… ${sec}s elapsed (lower "Max Results" = faster)`;
        }
    }, 5000);

    try {
        const promises = [];
        if (platformsToSearch.includes('tiktok')) promises.push(searchTikTok(topic, maxResults));
        if (platformsToSearch.includes('instagram')) promises.push(searchInstagram(topic, maxResults));
        if (platformsToSearch.includes('youtube')) promises.push(searchYouTube(topic, maxResults));

        const platformResults = await Promise.all(promises);
        clearInterval(elapsedInterval);
        const results = platformResults.flat();

        if (results.length === 0) {
            showStatus(
                'discoveryStatus',
                'No videos available for this search via Apify.',
                'info'
            );
            displayDiscoveryResults([]);
            return;
        }

        const filtered = results.filter(v =>
            v.views >= minViews && v.likes >= minLikes
        );

        let dateFiltered = filtered;
        if (dateFrom || dateTo) {
            dateFiltered = filtered.filter(v => {
                if (!v.createdAt) return true;
                const d = new Date(v.createdAt);
                return d >= new Date(dateFrom || '1900-01-01')
                    && d <= new Date(dateTo || Date.now());
            });
        }

        if (dateFiltered.length === 0) {
            showStatus(
                'discoveryStatus',
                `Found ${results.length} videos but none passed your filters (Min Views: ${minViews}, Min Likes: ${minLikes}). Try lowering Min Views / Min Likes or clearing the date range.`,
                'info'
            );
            displayDiscoveryResults([]);
            return;
        }

        dateFiltered.sort((a, b) => b.views - a.views);

        state.discoveryResults = dateFiltered;
        displayDiscoveryResults(dateFiltered);
        showStatus(
            'discoveryStatus',
            `Found ${dateFiltered.length} videos`,
            'success'
        );

    } catch (err) {
        clearInterval(elapsedInterval);
        console.error(err);
        let msg = 'Failed to fetch videos from Apify. ';
        if (err.message && err.message.includes('401')) {
            msg += 'Check your Apify API token in Settings (invalid or expired).';
        } else if (err.message && (err.message.includes('fetch') || err.message.includes('Network'))) {
            msg += 'Network or CORS issue — try again or check browser console (F12).';
        } else if (err.message) {
            msg += err.message;
        }
        showStatus('discoveryStatus', msg, 'error');
    } finally {
        showLoading('discoveryLoading', false);
    }
}



// ===================================
// TIKTOK SCRAPER
// ===================================

async function searchTikTok(topic, limit) {
    const apiToken = state.settings.tiktokApiToken;
    // Old clockworks/free-tiktok-scraper returns 404; use maintained keyword scraper
    let actorId = (state.settings.tiktokActorId || '').trim() || 'thescrapelab/tiktok-scraper-2-0';
    if (actorId === 'clockworks/free-tiktok-scraper') actorId = 'thescrapelab/tiktok-scraper-2-0';
    const actorIdForApi = apifyActorId(actorId);
    const searchInput = {
        workflow: 'keywords',
        keywords: [topic],
        maxVideosPerKeyword: Math.min(limit, 100)
    };

    console.log('TikTok input:', searchInput);
    
    const response = await corsfetch(`https://api.apify.com/v2/acts/${actorIdForApi}/runs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(searchInput)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('TikTok API error:', errorText);
        throw new Error(`TikTok API failed: ${response.status}`);
    }

    const runData = await response.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    console.log(`TikTok run started: ${runId}`);

    // Wait for completion
    await waitForApifyRun(runId, apiToken);

    // Get results
    const resultsResponse = await corsfetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
        headers: {
            'Authorization': `Bearer ${apiToken}`
        }
    });

    const videos = await resultsResponse.json();
    console.log('TikTok raw data:', videos[0]);

    return videos.map(v => {
        const s = v.stats || {};
        return {
            platform: 'TikTok',
            url: v.webVideoUrl || v.videoUrl || v.url || v.link || '',
            videoId: v.id || v.videoId || '',
            caption: v.text || v.desc || v.caption || '',
            creator: v.authorMeta?.name || v.author?.nickname || v.author?.uniqueId || v.owner?.nickname || '',
            creatorUsername: v.authorMeta?.nickName || v.author?.uniqueId || v.owner?.uniqueId || '',
            likes: toNum(v.diggCount ?? v.likes ?? s.diggCount),
            comments: getCommentCount(v),
            shares: toNum(v.shareCount ?? v.shares ?? s.shareCount),
            saves: toNum(v.collectCount ?? v.saves ?? s.collectCount),
            views: toNum(v.playCount ?? v.views ?? s.playCount),
            createdAt: v.createTime || v.createTimeISO || v.timestamp || v.createdAt || '',
            hashtags: Array.isArray(v.hashtags) ? v.hashtags.join(', ') : (v.hashtags || ''),
            thumbnail: v.covers?.default || v.video?.cover || v.thumbnail || v.coverUrl || ''
        };
    });
}

// ===================================
// INSTAGRAM SCRAPER
// ===================================

async function searchInstagram(topic, limit) {
    const apiToken = state.settings.instagramApiToken;
    // Use Instagram Hashtag Scraper (apify/instagram-scraper returns 404; this one is maintained)
    const actorId = state.settings.instagramActorId || 'apify/instagram-hashtag-scraper';
    const actorIdForApi = apifyActorId(actorId);
    const hashtag = topic.replace(/#/g, '').trim().split(/\s+/)[0] || topic; // one hashtag/keyword
    const searchInput = {
        hashtags: [hashtag],
        resultsLimit: limit
    };

    console.log('Instagram input:', searchInput);
    
    const response = await corsfetch(`https://api.apify.com/v2/acts/${actorIdForApi}/runs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(searchInput)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Instagram API error:', errorText);
        throw new Error(`Instagram API failed: ${response.status}`);
    }

    const runData = await response.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    console.log(`Instagram run started: ${runId}`);

    await waitForApifyRun(runId, apiToken);

    const resultsResponse = await corsfetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
        headers: {
            'Authorization': `Bearer ${apiToken}`
        }
    });

    const videos = await resultsResponse.json();
    console.log('Instagram raw data:', videos[0]);

    return videos.map(v => ({
        platform: 'Instagram',
        url: v.url || v.permalink || (v.shortCode ? `https://instagram.com/p/${v.shortCode}` : ''),
        videoId: v.id || v.shortCode || v.code || '',
        caption: v.caption || v.title || '',
        creator: v.ownerFullName || v.ownerUsername || v.owner?.full_name || '',
        creatorUsername: v.ownerUsername || v.owner?.username || '',
        likes: toNum(v.likesCount ?? v.likes ?? v.like_count),
        comments: getCommentCount(v),
        shares: 0,
        saves: 0,
        views: toNum(v.videoViewCount ?? v.videoViews ?? v.viewCount ?? v.playCount ?? v.views),
        createdAt: v.timestamp || v.takenAtTimestamp || v.createdAt || '',
        hashtags: Array.isArray(v.hashtags) ? v.hashtags.join(', ') : (v.hashtags || ''),
        thumbnail: v.displayUrl || v.thumbnailUrl || v.imageUrl || ''
    }));
}

// ===================================
// YOUTUBE SCRAPER
// ===================================

async function searchYouTube(topic, limit) {
    const apiToken = state.settings.youtubeApiToken;
    const actorId = state.settings.youtubeActorId || 'streamers/youtube-scraper';
    const actorIdForApi = apifyActorId(actorId);
    const searchInput = {
        searchKeywords: topic,
        maxResults: limit,
        uploadDate: 'all'
    };

    console.log('YouTube input:', searchInput);

    const response = await corsfetch(`https://api.apify.com/v2/acts/${actorIdForApi}/runs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
        },
        body: JSON.stringify(searchInput)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('YouTube API error:', errorText);
        throw new Error(`YouTube API failed: ${response.status}`);
    }

    const runData = await response.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    console.log(`YouTube run started: ${runId}`);

    await waitForApifyRun(runId, apiToken);

    const resultsResponse = await corsfetch(`https://api.apify.com/v2/datasets/${datasetId}/items`, {
        headers: {
            'Authorization': `Bearer ${apiToken}`
        }
    });

    const videos = await resultsResponse.json();
    console.log('YouTube raw data:', videos[0]);

    return videos.map(v => {
        const stats = v.statistics || v.stats || {};
        const views = toNum(v.views ?? v.viewCount ?? v.view_count ?? stats.viewCount ?? stats.view_count);
        const likes = toNum(v.likes ?? v.likeCount ?? v.like_count ?? stats.likeCount ?? stats.like_count);
        const comments = getCommentCount(v) || toNum(v.commentCount ?? v.comments ?? v.comment_count ?? stats.commentCount ?? stats.comment_count);
        return {
            platform: 'YouTube',
            url: v.url || `https://youtube.com/watch?v=${v.id}`,
            videoId: v.id || v.videoId || '',
            caption: v.title || v.snippet?.title || '',
            creator: v.channelName || v.snippet?.channelTitle || '',
            creatorUsername: v.channelHandle || v.channelId || '',
            likes,
            comments,
            shares: 0,
            saves: 0,
            views,
            createdAt: v.publishedAt || v.snippet?.publishedAt || v.uploadDate || '',
            hashtags: Array.isArray(v.tags) ? v.tags.join(', ') : (v.tags || ''),
            thumbnail: v.thumbnail || v.thumbnails?.high?.url || ''
        };
    });
}

// ===================================
// APIFY RUN WAITER
// ===================================

async function waitForApifyRun(runId, apiToken) {
    let attempts = 0;
    const maxAttempts = 180; // 6 minutes at 2s interval
    
    while (attempts < maxAttempts) {
        const statusResponse = await corsfetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
            headers: {
                'Authorization': `Bearer ${apiToken}`
            }
        });
        
        const runStatus = await statusResponse.json();
        const status = runStatus.data.status;
        
        if (attempts % 15 === 0 && attempts > 0) {
            console.log(`⏳ Run ${runId}: ${status} (${attempts * 2}s elapsed)`);
        }
        
        if (status === 'SUCCEEDED') {
            console.log(`✅ Run ${runId} completed!`);
            return runStatus.data;
        } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            throw new Error(`Apify run ${status.toLowerCase()}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
    }
    
    throw new Error('Apify run timeout');
}

// ===================================
// DISPLAY RESULTS
// ===================================

function displayDiscoveryResults(results) {
    const container = document.getElementById('discoveryResults');
    
    if (results.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <p>No videos available for this search via Apify.</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <div class="card">
            <h2 class="card-title">Discovery Results (${results.length} videos)</h2>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Select</th>
                        <th>Platform</th>
                        <th>Video</th>
                        <th>Creator</th>
                        <th>Caption</th>
                        <th>Views</th>
                        <th>Likes</th>
                        <th>Comments</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map((video, index) => `
                        <tr>
                            <td>
                                <input type="checkbox" class="checkbox" data-index="${index}">
                            </td>
                            <td>
                                <span class="platform-badge platform-${video.platform.toLowerCase()}">${video.platform}</span>
                            </td>
                            <td>
                                <a href="${video.url}" target="_blank" class="link">View</a>
                            </td>
                            <td>
                                <div>${video.creator}</div>
                                <div style="color: var(--text-tertiary); font-size: 0.85rem;">@${video.creatorUsername}</div>
                            </td>
                            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${video.caption}
                            </td>
                            <td>
                                <span class="metric-value">${formatNumber(video.views)}</span>
                            </td>
                            <td>
                                <span class="metric-value">${formatNumber(video.likes)}</span>
                            </td>
                            <td>
                                <span class="metric-value">${formatNumber(video.comments)}</span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = tableHTML;
}

// ===================================
// TRANSCRIPTION
// ===================================

async function startTranscription() {
    const urlsText = document.getElementById('transcriptUrls').value.trim();
    if (!urlsText) {
        showStatus('transcriptionStatus', 'Please enter video URLs', 'error');
        return;
    }

    if (!state.settings.transcribeToken) {
        showStatus('transcriptionStatus', 'Please configure your GetTranscribe API token in Settings', 'error');
        return;
    }

    const urls = urlsText.split('\n').map(url => url.trim()).filter(Boolean);

    showLoading('transcriptionLoading', true);
    showStatus('transcriptionStatus', `Transcribing ${urls.length} videos...`, 'info');

    const results = [];

    for (const url of urls) {
        try {
            const transcript = await transcribeVideo(url);
            results.push({
                url,
                transcript,
                status: 'success'
            });
        } catch (error) {
            // For YouTube: try built-in captions when GetTranscribe fails
            const ytId = getYouTubeVideoId(url);
            if (ytId) {
                const captionText = await tryYouTubeCaptions(ytId);
                if (captionText && captionText.length > 20) {
                    results.push({ url, transcript: captionText, status: 'success' });
                    continue;
                }
            }
            results.push({
                url,
                transcript: '',
                status: 'error',
                error: parseGetTranscribeError(error.message)
            });
        }
    }

    state.transcriptionResults = results;
    displayTranscriptionResults(results);

    const successCount = results.filter(r => r.status === 'success').length;

    if (successCount === 0) {
        showStatus(
            'transcriptionStatus',
            'No transcripts were generated for the provided URLs.',
            'error'
        );
    } else {
        showStatus(
            'transcriptionStatus',
            `Transcribed ${successCount} of ${urls.length} videos`,
            'success'
        );
    }

    showLoading('transcriptionLoading', false);
}


// Turn GetTranscribe API error JSON into a short user-friendly message
function parseGetTranscribeError(msg) {
    if (!msg) return 'Transcription failed.';
    if (msg.includes('no_audio') || msg.includes('without audio') || msg.includes('media without audio')) {
        return 'No audio in this media. Use a video with speech (e.g. Reels), not image posts or silent clips.';
    }
    if (msg.includes('Failed to download') || msg.includes('all methods failed') || msg.includes('YouTube audio')) {
        return 'GetTranscribe couldn\'t download this video\'s audio (common with some YouTube videos). Try TikTok or Instagram Reels URLs, or a different public YouTube video.';
    }
    try {
        const json = msg.replace(/^GetTranscribe error:\s*/, '').trim();
        const data = JSON.parse(json);
        return data.userMessage || data.message || (data.data && data.data.userMessage) || msg;
    } catch (_) {
        return msg.length > 120 ? msg.substring(0, 120) + '…' : msg;
    }
}

// Extract YouTube video ID from common URL formats
function getYouTubeVideoId(url) {
    if (!url || !url.includes('youtube')) return null;
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

// Try to get captions from YouTube (no API key). Works when video has captions.
async function tryYouTubeCaptions(videoId) {
    const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`;
    try {
        const proxyUrl = CORS_PROXY + encodeURIComponent(timedtextUrl);
        const res = await fetch(proxyUrl);
        if (!res.ok) return null;
        const text = await res.text();
        if (!text || text.length < 10) return null;
        // Parse XML: <text start="..." dur="...">content</text> or plain text lines
        const textNodes = text.match(/<text[^>]*>([^<]*)<\/text>/g);
        if (textNodes && textNodes.length > 0) {
            return textNodes
                .map(node => node.replace(/<text[^>]*>|<\/text>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'"))
                .join(' ')
                .trim();
        }
        // Plain text or other format: use as-is, strip tags
        return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (_) {
        return null;
    }
}

async function transcribeVideo(url) {
    const response = await fetch('https://api.gettranscribe.ai/transcriptions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': state.settings.transcribeToken
        },
        body: JSON.stringify({ url })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GetTranscribe error: ${errorText}`);
    }

    const data = await response.json();

    if (!data.transcript && !data.text) {
        throw new Error('Transcript not available for this video');
    }

    return data.transcript || data.text;
}


function displayTranscriptionResults(results) {
    const container = document.getElementById('transcriptionResults');

    const tableHTML = `
        <div class="card">
            <h2 class="card-title">Transcription Results (${results.length} videos)</h2>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Video URL</th>
                        <th>Status</th>
                        <th>Transcript Preview</th>
                    </tr>
                </thead>
                <tbody>
                    ${results.map(result => `
                        <tr>
                            <td>
                                <a href="${result.url}" target="_blank" class="link">
                                    ${result.url.substring(0, 50)}...
                                </a>
                            </td>
                            <td>
                                ${result.status === 'success' 
                                    ? '<span style="color: var(--accent);">✓ Success</span>' 
                                    : '<span style="color: #c41e1e;">✗ Failed</span>'}
                            </td>
                            <td>
                                ${result.transcript 
                                    ? `<div class="transcript-preview">${escapeHtml(result.transcript.substring(0, 300))}${result.transcript.length > 300 ? '…' : ''}</div>`
                                    : `<span class="transcript-preview" style="color: #721c24;">${escapeHtml(result.error || 'No transcript')}</span>`}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = tableHTML;
}

function loadSelectedFromDiscovery() {
    const checkboxes = document.querySelectorAll('#discoveryResults .checkbox:checked');
    const selectedUrls = Array.from(checkboxes).map(cb => {
        const index = parseInt(cb.dataset.index);
        return state.discoveryResults[index].url;
    });

    if (selectedUrls.length === 0) {
        showStatus('transcriptionStatus', 'No videos selected from Discovery tab', 'error');
        return;
    }

    document.getElementById('transcriptUrls').value = selectedUrls.join('\n');
    showStatus('transcriptionStatus', `Loaded ${selectedUrls.length} videos from Discovery`, 'success');
}

// ===================================
// GOOGLE SHEETS
// ===================================

async function connectGoogleSheets() {
    showStatus('settingsStatus', 'Google Sheets OAuth coming soon. For now, use CSV export.', 'info');
}

async function exportToSheets() {
    if (state.discoveryResults.length === 0) {
        showStatus('discoveryStatus', 'No results to export', 'error');
        return;
    }
    
    exportAsCSV(state.discoveryResults, 'discovery_results.csv');
    showStatus('discoveryStatus', 'Exported as CSV. You can import to Google Sheets.', 'success');
}

async function updateSheetsWithTranscripts() {
    if (state.transcriptionResults.length === 0) {
        showStatus('transcriptionStatus', 'No transcriptions to export', 'error');
        return;
    }
    
    exportAsCSV(state.transcriptionResults, 'transcription_results.csv');
    showStatus('transcriptionStatus', 'Exported as CSV. You can import to Google Sheets.', 'success');
}

function testSheetConnection() {
    showStatus('settingsStatus', 'Sheet connection test coming soon.', 'info');
}

// ===================================
// UTILITY FUNCTIONS
// ===================================

function showLoading(elementId, show) {
    const element = document.getElementById(elementId);
    if (show) {
        element.classList.add('active');
    } else {
        element.classList.remove('active');
    }
}

function showStatus(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
    
    if (type === 'success') {
        setTimeout(() => {
            element.innerHTML = '';
        }, 5000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const s = String(str);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function exportAsCSV(data, filename) {
    if (data.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            const value = row[header] || '';
            return `"${value.toString().replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}
