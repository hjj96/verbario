import Foundation
import ImageIO
import UIKit

/// Files shared by the app and the widget: `state.json` with the composition and
/// the prepared images. Both live in the App Group container.
enum FridgeStorage {
    static let widgetKind = "FridgeWidget"

    enum LoadResult {
        case loaded(FridgeState)
        case missing
        case corrupted
    }

    enum ImageVariant {
        /// Used by the editor (up to 1400 px).
        case full
        /// Small copy for the widget, which has a tight memory budget.
        case widget
    }

    static var appGroupID: String {
        (Bundle.main.object(forInfoDictionaryKey: "FridgeAppGroup") as? String) ?? "group.com.example.myfridge"
    }

    /// Falls back to the app's own folder when the App Group is not configured yet
    /// (the app still works, only the widget cannot see the door).
    static var rootURL: URL {
        let fileManager = FileManager.default
        let base = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return ensureDirectory(base.appendingPathComponent("MyFridge", isDirectory: true))
    }

    static var imagesURL: URL {
        ensureDirectory(rootURL.appendingPathComponent("Images", isDirectory: true))
    }

    static var stateURL: URL {
        rootURL.appendingPathComponent("state.json")
    }

    // MARK: State

    static func loadState(backupOnFailure: Bool) -> LoadResult {
        let url = stateURL
        guard let data = try? Data(contentsOf: url) else { return .missing }
        do {
            return .loaded(try JSONDecoder().decode(FridgeState.self, from: data))
        } catch {
            if backupOnFailure {
                let stamp = Int(Date().timeIntervalSince1970)
                let backup = rootURL.appendingPathComponent("state-unreadable-\(stamp).json")
                try? FileManager.default.copyItem(at: url, to: backup)
            }
            return .corrupted
        }
    }

    static func save(_ state: FridgeState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(state)
        try data.write(to: stateURL, options: [.atomic])
    }

    // MARK: Images

    static func imageURL(_ file: String, variant: ImageVariant) -> URL {
        switch variant {
        case .full:
            return imagesURL.appendingPathComponent(file)
        case .widget:
            let name = (file as NSString).deletingPathExtension
            let ext = (file as NSString).pathExtension
            return imagesURL.appendingPathComponent("\(name)-w.\(ext)")
        }
    }

    static func loadImage(_ file: String, variant: ImageVariant) -> UIImage? {
        UIImage(contentsOfFile: imageURL(file, variant: variant).path)
    }

    /// Widget-safe loading: prefers the small copy and downsamples the big one if needed.
    static func loadWidgetImage(_ file: String) -> UIImage? {
        if let small = loadImage(file, variant: .widget) { return small }
        return downsampledImage(at: imageURL(file, variant: .full), maxPixel: 520)
    }

    static func downsampledImage(at url: URL, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return downsampledImage(from: source, maxPixel: maxPixel)
    }

    static func downsampledImage(from source: CGImageSource, maxPixel: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    /// Deletes image files no item refers to. Called on launch only, when the undo history is empty.
    static func removeUnusedImages(keeping state: FridgeState) {
        var keep = Set<String>()
        for item in state.items {
            if case .photo(let photo) = item.content {
                keep.insert(imageURL(photo.file, variant: .full).lastPathComponent)
                keep.insert(imageURL(photo.file, variant: .widget).lastPathComponent)
            }
        }
        let fileManager = FileManager.default
        let folder = imagesURL
        guard let files = try? fileManager.contentsOfDirectory(atPath: folder.path) else { return }
        for file in files where !keep.contains(file) {
            try? fileManager.removeItem(at: folder.appendingPathComponent(file))
        }
    }

    private static func ensureDirectory(_ url: URL) -> URL {
        let fileManager = FileManager.default
        if !fileManager.fileExists(atPath: url.path) {
            try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        }
        return url
    }
}
