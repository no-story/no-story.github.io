FIRST_CHAPTER   = 1;
FIRST_PAGE      = 0;

DEFAULT_CHAPTER = 1;
DEFAULT_PAGE    = FIRST_PAGE;

CONTENT_PATH = "/media/chapters/"; // must include trailing slash

async function fetchContent(path) {
    let response = await fetch(CONTENT_PATH + path);
    if (!response.ok)
        throw new Error(`Failed to request '${path}': ${response.status} ${response.statusText}`);
    return response;
}

async function fetchBlob(path) {
    let response = await fetchContent(path);
    let imgData = await response.blob();
    return imgData;
}

async function fetchSeriesMeta() {
    try {
        let response = await fetchContent('series.json');
        let jsonData = response.json();
        return jsonData;
    } catch (error) {
        console.error(error);
    }
}

async function fetchCover() {
    try {
        let blob = fetchBlob('cover.png');
        return blob;
    } catch (error) {
        console.error(error);
    }
}

async function fetchPage(chapter, page) {
    chapter = `${chapter}`.padStart(3, '0');
    page    = `${page}`.padStart(3, '0');
    try {
        let blob = fetchBlob(`${chapter}/${page}.png`);
        return blob;
    } catch (error) {
        console.error(error);
    }
}

function getProgressFromURL({ chapter: defaultChapter, page: defaultPage }) {
    var urlHash = window.location.hash.slice(1) || "/";
    var chPg = urlHash.split("/");

    var chapter = chPg[0] || defaultChapter;
    var page    = chPg[1] || defaultPage;
    return {
        chapter, page,
        paddedChapter: `${chapter}`.padStart(3, '0'),
        paddedPage:    `${page}`.padStart(3, '0'),
        urlHash: `#${urlHash}`
    }
}

function isElementVisible(elem) {
    const { top, bottom } = elem.getBoundingClientRect();
    const height = elem.clientHeight;

    if (top <= height/2 && bottom >= height/2) {
        return true;
    }

    return false;
}

function Reader(o={}) {
    this.defaultProgress = o.defaultProgress || {
        chapter: DEFAULT_CHAPTER,
        page: DEFAULT_PAGE
    };

    this.firstChapter = FIRST_CHAPTER;
    this.firstPage = FIRST_PAGE;

    this.elems = {
        series: {
            title:       document.getElementById('series-title'),
            description: document.getElementById('series-desc'),
            cover:       document.getElementById('series-cover')
        },
        chapter: {
            title:       document.getElementById('chapter-title'),
            progress:    document.getElementById('chapter-progress'),
            description: document.getElementById('chapter-desc'),
            commentary:  document.getElementById('commentary-text'),
            info:        document.getElementById('chapter-info')
        },
        page: {
            info:        document.getElementById('page-info'),
            progress:    document.getElementById('page-progress'),
        },
        reader:          document.getElementById("reader"),
        rNav: {
            prev:        document.getElementById("prev-nav"),
            next:        document.getElementById("next-nav")
        },
        loading: {
            overlay:     document.getElementById('loading-overlay'),
            progress:    document.getElementById('loading-progress')
        },
        progBar:         document.getElementById('progress-bar')
    }

    this.currentProgress = getProgressFromURL(this.defaultProgress);
    this.lastProgress    = {};

    this.updatedHash = `#${this.currentProgress.chapter}/${this.currentProgress.page}`;

    this.isLoading = false;

    this.getSeriesInfo = async function() {
        var seriesInfo      = !((this.seriesState || {}).seriesInfo)
                                ? await fetchSeriesMeta()
                                : this.seriesState.seriesInfo;
        
        var currentChapter  = seriesInfo.chapters[this.currentProgress.paddedChapter];
        var totalChapters   = Object.keys(seriesInfo.chapters).length;

        return { seriesInfo, currentChapter, totalChapters };
    }

    this.initReader = async function() {
        this.seriesState = await this.getSeriesInfo();
        await this.updateProgress(this.currentProgress);
        await this.loadImages();
    }

    this.loadImages = async function() {
        if (this.isLoading) return;
        this.isLoading = true;

        const { reader, series, loading } = this.elems;
        const { currentChapter } = this.seriesState;

        loading.overlay.style.display = 'flex';
        loading.progress.innerHTML = `Chapter ${this.currentProgress.chapter}`;

        let coverImg = await fetchCover();
        series.cover.src = URL.createObjectURL(coverImg);

        reader.innerHTML = "";
        loading.progress.style.opacity = 1;

        for (let i = 0; i <= currentChapter.pages; i++) {
            try {
                var pageImg = await fetchPage(this.currentProgress.chapter, i);
            
                let pageElem = document.createElement('img');
                pageElem.src = URL.createObjectURL(pageImg);
                pageElem.loading = "eagar";
                pageElem.dataset.page = i;
                pageElem.classList.add("reader-page");
                reader.append(pageElem);
                loading.progress.innerHTML = `${parseInt(((i+1)/currentChapter.pages)*100)}%`;
            } catch (error) {
                if (error.message.includes("404")) {
                    console.log(`Skipping page ${i} due to 404 error.`);
                }
                // If the error is not 404, something is wrong, so dont skip.
            }
        }

        firstLoadedPage = reader.children[0].dataset.page;
        if (firstLoadedPage >= 0 && firstLoadedPage != this.firstPage) {
            this.firstPage = firstLoadedPage;
            this.updateProgress(this.currentProgress);
        }

        loading.progress.style.opacity = 0;

        this.scrollToPage(this.currentProgress.page);

        let ticking   = false,
            readerObj = this;
        reader.parentElement.addEventListener("scroll", function(event) {
            if (!ticking) {
                requestAnimationFrame(function() {
                    readerObj.onReaderScroll();
                    ticking = false;
                });

                ticking = true;
            }
        });

        loading.overlay.style.display = 'none';

        this.isLoading = false;
    }

    this.onReaderScroll = function() {
        const { reader } = this.elems;

        let pages = reader.querySelectorAll(".reader-page");
        pages.forEach(page => {
            if (isElementVisible(page) && this.currentProgress.page != page.dataset.page) {
                console.log(`Page ${page.dataset.page} is visible.`);
                this.updateProgress({page: page.dataset.page});
            }
        });
    }

    this.scrollToPage = function(page) {
        const { reader } = this.elems;
        let pageElem = reader.querySelector(`.reader-page[data-page="${page}"]`);
        pageElem.scrollIntoView();
    }

    this.isProgressUpdated = function() {
        if ((this.lastProgress.chapter && this.lastProgress.page) &&
            this.lastProgress.chapter != this.currentProgress.chapter &&
            this.lastProgress.page != this.currentProgress.page) {
            return true;
        }

        return false;
    }

    this.updateHTML = function() {
        if (!this.seriesState) {
            throw new Error('seriesState needs to be defined before updateHTML can be called.');
        }

        const { series, chapter, page, rNav } = this.elems;
        const {seriesInfo: meta, currentChapter, totalChapters} = this.seriesState;

        series.title.innerHTML       = meta.series.title;
        series.description.innerHTML = meta.series.description;

        chapter.title.innerHTML       = currentChapter.title;
        chapter.description.innerHTML = currentChapter.description;
        chapter.commentary.innerHTML  = currentChapter.commentary;
        chapter.progress.innerHTML    = `(${this.currentProgress.chapter}/${totalChapters})`;
        chapter.info.innerHTML    = `Chapter ${this.currentProgress.chapter}`

        let prevChapterEvent = this.prevChapter.bind(this);
        let nextChapterEvent = this.nextChapter.bind(this);

        if (this.currentProgress.chapter > this.firstChapter) {
            rNav.prev.innerHTML = "Previous Chapter";
            rNav.prev.classList.add("active");
            rNav.prev.addEventListener("click", prevChapterEvent);
        } else {
            rNav.prev.classList.remove("active");
            rNav.prev.innerHTML = "You're on the first chapter."
        }
        
        if (this.currentProgress.chapter < totalChapters) {
            rNav.next.innerHTML = "Next Chapter";
            rNav.next.classList.add("active");
            rNav.next.addEventListener("click", nextChapterEvent);
        } else {
            rNav.next.classList.remove("active");
            rNav.next.innerHTML = "You're all caught up!"
        }

        page.info.style.visibility = this.currentProgress.page <= 0 ? 'hidden' : 'unset';
        page.progress.innerHTML = this.currentProgress.page <= 0 ? "" : `${this.currentProgress.page}/${currentChapter.pages}`;
    }

    this.prevChapter = async function() {
        if (this.isLoading) return;
        if (this.currentProgress.chapter > this.firstChapter) {
            let prevChapterProgress = { chapter: this.currentProgress.chapter - 1, page: 0 }
            await this.updateProgress(prevChapterProgress);
            await this.loadImages();
            this.scrollToPage(this.firstPage);
        }
    }

    this.nextChapter = async function() {
        if (this.isLoading) return;
        if (this.currentProgress.chapter < this.seriesState.totalChapters) {
            let nextChapterProgress = { chapter: this.currentProgress.chapter + 1, page: 0 }
            await this.updateProgress(nextChapterProgress);
            await this.loadImages();
            this.scrollToPage(this.firstPage);
        }
    }

    this.updateProgress = async function({chapter, page}) {
        this.lastProgress = this.currentProgress;
        this.currentProgress = this.getProgress({chapter, page});
        this.seriesState = await this.getSeriesInfo();

        document.title = `Read ${this.seriesState.seriesInfo.series.title} Chapter ${this.currentProgress.chapter} by ${this.seriesState.seriesInfo.series.author}`;
        this.elems.progBar.style.width = (this.currentProgress.page / this.seriesState.currentChapter.pages) * 100 + "%";
        this.updateHTML();
        this.updatedHash = `#${this.currentProgress.chapter}/${this.currentProgress.page}`;
        window.history.replaceState(undefined, undefined, this.updatedHash);
    }

    this.getProgress = function({chapter, page}) {
        if (!this.seriesState) {
            throw new Error('seriesState needs to be defined before getProgress can be called.');
        }

        if (!chapter)
            chapter = this.currentProgress.chapter || this.defaultProgress.chapter;
        else if (chapter < this.firstChapter) chapter = this.firstChapter;
        else if (chapter > this.seriesState.totalChapters)
            chapter = this.seriesState.totalChapters;
        
        let chapterInfo = this.seriesState.seriesInfo.chapters[`${chapter}`.padStart(3, '0')];

        if (!page)
            page = this.currentProgress.page || this.defaultProgress.page;
        else if (page < this.firstPage) page = this.firstPage;
        else if (page > chapterInfo.pages)
            page = chapterInfo.pages

        return {
            chapter, page,
            paddedChapter: `${chapter}`.padStart(3, '0'),
            paddedPage:    `${page}`.padStart(3, '0'),
            totalPages:    chapterInfo.pages,
            totalChapters: this.seriesState.totalChapters
        }
    }
}

var reader;

document.addEventListener("DOMContentLoaded", async () => {
    reader = new Reader();
    reader.initReader();

    window.addEventListener("hashchange", async (event) => {
        var newProgress = getProgressFromURL(reader.defaultProgress);
        if (newProgress.urlHash != reader.updatedHash) {
            await reader.updateProgress(newProgress);
            if (newProgress.chapter != reader.lastProgress.chapter) {
                await reader.loadImages()
            }
            reader.scrollToPage(newProgress.page);
        }
    });

    document.getElementById("info-dropdown").addEventListener("click", () => {
        const infoPanel = document.querySelector(".right-column > .top");
        const buttonArea = document.querySelector(".right-column > .bottom");
        const infoPanelBtn = document.querySelector("#info-dropdown > .fas");

        infoPanel.classList.toggle("m-hidden");
        buttonArea.classList.toggle("m-hidden");

        if (infoPanel.classList.contains("m-hidden")) {
            infoPanelBtn.className = "fas fa-chevron-down";
        } else {
            infoPanelBtn.className = "fas fa-chevron-up";
        }
    });
});