interface CategoryTabsProps {
  categories: string[];
  active: string;
  onSelect: (category: string) => void;
}

export default function CategoryTabs({
  categories,
  active,
  onSelect,
}: CategoryTabsProps) {
  const allTabs = ["All", ...categories];

  return (
    <div className="flex overflow-x-auto hide-scrollbar gap-2 px-4 py-3 bg-white border-b border-gray-200">
      {allTabs.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={`flex-shrink-0 min-h-[48px] px-5 rounded-lg text-[16px] font-medium transition-colors ${
            active === cat
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 active:bg-gray-200"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
