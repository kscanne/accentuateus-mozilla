if ("undefined" == typeof(Charlifter)) {
    var Charlifter = {};
};

Charlifter.SQL = function() {
    let db = null;
    let prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
        .getService(Ci.nsIPromptService);
    let connect = function() {
        /* Connects to sqlite file if not already done so */
        if (db === null) {
            let file  = Components.classes["@mozilla.org/file/"
                        + "directory_service;1"]
                         .getService(Components.interfaces.nsIProperties)
                         .get("ProfD", Components.interfaces.nsIFile);
            file.append("charlifter.sqlite");
            let storageService = Components.classes["@mozilla.org/storage"
                                 + "/service;1"]
                                    .getService(Components.interfaces
                                        .mozIStorageService);
            try {
                db = storageService.openDatabase(file);
                db.executeSimpleSQL(
                    "CREATE TABLE IF NOT EXISTS langs (code VARCHAR(5)"
                        + ", localization VARCHAR(255))"
                );
            }
            catch(err) {
                prompts.alert(window
                    , strbundle.getString("errors-context-menu-title")
                    , strbundle.getString("errors-context-menu")
                );
            }
            // Initialize lang table if not in existence
        }
    };
    let query = function(query) {
        /* Connects to db if necessary and creates query statement */
        if (db === null) { connect(); }
        return db.createStatement(query);
    };
    return {
        clearLangs : function(callbacks) {
            /* Clears languages from database. */
            let statement = query("DELETE FROM langs");
            statement.executeAsync(callbacks);
        },
        newLangs : function(langs, callbacks) {
            /* Takes languages as [[ISO-639, Localized Name],
                [ISO 639, Localized Name], ...] */
            let statement = query("INSERT INTO langs (code, localization)"
                + " VALUES (:code, :localization)");
            let params = statement.newBindingParamsArray();
            for (let lang in langs) {
                let bp = params.newBindingParams();
                bp.bindByName("code",        langs[lang][0]);
                bp.bindByName("localization",langs[lang][1]);
                params.addParams(bp);
            }
            statement.bindParameters(params);
            statement.executeAsync(callbacks);
        },
        getLangs : function(callbacks) {
            /* Return languages. */
            let statement = query("SELECT code, localization FROM langs");
            statement.executeAsync(callbacks);
        },
        getNumLangs : function(callbacks) {
            /* Return languages. */
            let statement = query("SELECT count(*) FROM langs");
            statement.executeAsync(callbacks);
        },
        getLangLocalization : function(code, callbacks) {
            /* Provides stored lang localization when provided ISO 639 code. */
            let statement = query("SELECT localization FROM langs WHERE code "
                + "== :code LIMIT 1");
            statement.params.code = code;
            statement.executeAsync(callbacks);
        },
    }
}();

Charlifter.Lifter = function() {
    let codes = { // API Response Codes
          liftSuccess       : 200
        , liftFailUnknown   : 400
        , langListOutdated  : 100
        , langListCurrent   : 200
    };
    let populatedLangTable = false;
    let prefs = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService);
    let cprefs = prefs.getBranch("charlifter.languages.");
    let strbundle   = null;
    let prompts     = Cc["@mozilla.org/embedcomp/prompt-service;1"]
        .getService(Ci.nsIPromptService);
    let genRequest  = function(args, success, error) {
        /* Abstracts API calling code */
        let url = "http://ares:1932/";
        let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
            .createInstance(Ci.nsIXMLHttpRequest);
        request.open("POST", url, true);
        request.onload  = success;
        request.onerror = error;
        request.setRequestHeader("Content-ype", "application/json");
        request.setRequestHeader("charset", "UTF-8");
        request._call = JSON.stringify(args);
        return request;
    };
    let populateLangsMenu = function() {
        /* Populate language list menu. */
        let langsMenu = document.getElementById(
            "charlifter-cmenu-languages-item");
        Charlifter.SQL.getLangs({
            handleResult: function(aResultSet) {
                for (let row=aResultSet.getNextRow();
                    row; row=aResultSet.getNextRow()) {
                        let ele = langsMenu.appendItem(
                              strbundle.getFormattedString(
                                "lift-csubmenu-item-label", [
                                    row.getResultByName("localization")
                                  , row.getResultByName("code")
                              ])
                            , row.getResultByName("code")
                        );
                        ele.setAttribute("oncommand",
                            "Charlifter.Lifter.liftSelection('"
                                + row.getResultByName("code") + "')");
                }
            },
            handleError: function(aError) {
                prompts.alert(window
                    , strbundle.getString("errors-context-menu-title")
                    , strbundle.getString("errors-context-menu")
                );
            },
            handleCompletion: function(aCompletion) {},
        });
    };
    let S4 = function() {
       return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    }
    let uuid = function() {
       return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
    }
    let cid = "_-charlifter-id"; // Charlifter attribute name
    let pageElements = {};
    return {
        init : function() {
            strbundle = document.getElementById("charlifter-string-bundle");
            /* Create dynamic menu of available languages */
            let contextMenu = document.getElementById("contentAreaContextMenu");
            contextMenu.addEventListener("popupshowing", this.readyContextMenu
                , false);
            // If database empty, ensure version = 0
            Charlifter.SQL.getNumLangs({
                handleResult: function(aR) {
                    if (aR.getNextRow().getResultByIndex(0) == 0) {
                        cprefs.setIntPref("version", 0);
                    }
                },
                handleError: function(aE) {},
                handleCompletion: function(aC) {},
            });
            this.populateLangTable();
        },
        populateLangTable : function() {
            this.getLangs(function(aSuccess) {
                let response = {};
                try {
                    response = JSON.parse(aSuccess.target.responseText);
                } catch(err) {
                    prompts.alert(window, strbundle.getString("errors-title")
                        , strbundle.getString("errors-unknown"));
                }
                switch(response.code) {
                    case codes.langListOutdated:
                        /* New list available. Clear old languages
                            and insert new list to database. */
                        let langs = response.text.split('\n');
                        for (let langPair in langs) {
                            langs[langPair] = langs[langPair].split(':');
                        }
                        Charlifter.SQL.clearLangs({
                            handleResult: function(aResultSet) {},
                            handleError: function(aError) {},
                            handleCompletion: function(aCompletion) {},
                        });
                        Charlifter.SQL.newLangs(langs, {
                            handleResult: function(aResultSet) {},
                            handleError: function(aError) {
                                populateLangsMenu();
                            },
                            handleCompletion: function(aCompletion) {
                                populateLangsMenu();
                            },
                        });
                        cprefs.setIntPref("version", response.version);
                        populatedLangTable = true;
                        break;
                    case codes.langListCurrent:
                        populateLangsMenu();
                        populatedLangTable = true;
                        break;
                    default:
                        populateLangsMenu();
                        break;
                }
            }, function(aError) {
                populateLangsMenu();
            });
        },
        readyContextMenu : function(aE) {
            /* Hide context menu elements where appropriate */
            let liftCancelItem = document.getElementById(
                "charlifter-cmenu-item-lift-cancel");
            let liftItem    = document.getElementById(
                "charlifter-cmenu-item-lift");
            let langsItem   = document.getElementById(
                "charlifter-cmenu-languages-item");
            if (langsItem.childNodes[0].childNodes.length != 0) {
                let lang    = cprefs.getCharPref("selection-code");
                let focused = document.commandDispatcher.focusedElement;
                Charlifter.SQL.getLangLocalization(lang, {
                    handleResult: function(aResult) {
                        liftItem.setAttribute("label"
                            , strbundle.getFormattedString(
                                "lift-citem-label", [
                                      aResult.getNextRow().getResultByName(
                                        "localization")
                                    , lang
                            ]
                        ));
                    },
                    handleError: function(aError) {
                        prompts.alert(window
                            , strbundle.getString(
                                "errors-lang-localization-title")
                            , strbundle.getString(
                                "errors-lang-localization"));
                    },
                    handleCompletion: function(aCompletion) {},
                });
                liftItem.setAttribute("oncommand",
                    "Charlifter.Lifter.liftSelection('"
                        + lang + "')");
                let request = null;
                try {
                    request = pageElements[focused.getAttribute(cid)];
                } catch(err) {}
                if (request != null) {
                    liftCancelItem.disabled = false;
                    liftItem.disabled       = true;
                    langsItem.disabled      = true;
                }
                else {
                    liftCancelItem.disabled = true;
                    liftItem.disabled       = !(gContextMenu.onTextInput);
                    langsItem.disabled      = !(gContextMenu.onTextInput);
                }
            }
            else {
                liftItem.disabled       = true;
                langsItem.disabled      = true;
                liftCancelItem.disabled = true;
            }
        },
        getLangs : function(success, error) {
            /* API Call: Get language list */
            let locale  = prefs.getBranch("general.useragent.")
                .getCharPref("locale");
            let version = 0; // Forces new list retrieval
            if (locale == cprefs.getCharPref("locale")) {
                version = cprefs.getIntPref("version");
            }
            else { // Charlifter Locale Mismatch
                cprefs.setCharPref("locale", locale);
            }
            request = genRequest({
                  call:     "charlifter.langs"
                , version:  version
                , locale:   locale
            }, success, error);
            try {
                request.send(request._call);
            }
            catch (err) {
                prompts.alert(window
                    , strbundle.getString("errors-communication-title")
                    , strbundle.getString("errors-communication")
                );
            }
        },
        lift : function(lang, text, success, error) {
            /* API Call: Lift text */
            let locale = prefs.getBranch("general.useragent.")
                .getCharPref("locale");
            request = genRequest({
                  call:     "charlifter.lift"
                , lang:     lang
                , text:     text
                , locale:   locale
            }, success, error);
            try {
                request.send(request._call);
            }
            catch (err) {
                prompts.alert(window
                    , strbundle.getString("errors-communication-title")
                    , strbundle.getString("errors-communication")
                );
            }
            /* Store last used language code and localization in preferences */
            cprefs.setCharPref("selection-code", lang);
            return request;
        },
        cancelLift : function(cid) {
            pageElements[cid].abort();
            pageElements[cid] = null;
        },
        cancelLiftSelection : function() {
            let focused = document.commandDispatcher.focusedElement;
            try {
                this.cancelLift(focused.getAttribute(cid));
            } catch(err) {}
            focused.readOnly = false;
        },
        liftSelection : function(lang) {
            /* Makes lift function specific to form element */
            let focused = document.commandDispatcher.focusedElement;
            focused.readOnly = true;
            let ocursor = focused.style.cursor;
            focused.style.cursor = "wait";
            if (!focused.hasAttribute(cid)) {
                focused.setAttribute(cid, uuid());
            }
            pageElements[focused.getAttribute(cid)]
                = this.lift(lang, focused.value, function(aSuccess) {
                    let response = {};
                    try {
                        response = JSON.parse(aSuccess.target.responseText);
                    } catch(err) {
                        focused.readOnly = false;
                        focused.style.cursor = ocursor;
                        prompts.alert(window
                            , strbundle.getString("errors-title")
                            , strbundle.getString("errors-unknown"));
                    }
                    switch (response.code) {
                        case codes.liftSuccess:
                            focused.value = response.text;
                            break;
                        case codes.liftFailUnknown:
                            prompts.alert(window
                                , strbundle.getString("errors-title")
                                , response.text);
                            break;
                        default:
                            break;
                    }
                    focused.readOnly = false;
                    focused.style.cursor = ocursor;
                    pageElements[focused.getAttribute(cid)] = null;
                }, function(aError) {
                    focused.readOnly = false;
                    focused.style.cursor = ocursor;
                    pageElements[focused.getAttribute(cid)] = null;
                    prompts.alert(window,
                          strbundle.getString("errors-lift-selection-title")
                        , strbundle.getString("errors-lift-selection"));
                });
        },
    }
}();

window.addEventListener("load", function() {
        Charlifter.Lifter.init();
    }, false);
