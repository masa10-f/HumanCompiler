'use client';

import { ChevronDownIcon } from '@heroicons/react/20/solid';
// React imports
import { Fragment } from 'react';

// UI libraries
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';

// Utilities
import { cn } from '@/lib/utils';

// Types
import { SortBy, SortOrder, SortOptions } from '@/types/sort';

interface SortDropdownProps {
  currentSort: SortOptions;
  onSortChange: (sortOptions: SortOptions) => void;
  sortFields?: { value: SortBy; label: string }[];
  className?: string;
}

const defaultSortFields = [
  { value: SortBy.STATUS, label: 'ステータス' },
  { value: SortBy.TITLE, label: 'タイトル' },
  { value: SortBy.CREATED_AT, label: '作成日' },
  { value: SortBy.UPDATED_AT, label: '更新日' },
];

export function SortDropdown({
  currentSort,
  onSortChange,
  sortFields = defaultSortFields,
  className,
}: SortDropdownProps) {
  const currentField = sortFields.find(f => f.value === currentSort.sortBy) || sortFields[0] || { value: SortBy.STATUS, label: 'Status' };
  const isAscending = currentSort.sortOrder === SortOrder.ASC;

  const handleSortFieldChange = (field: SortBy) => {
    if (!Object.values(SortBy).includes(field)) {
      console.warn('Invalid sort field:', field);
      return;
    }
    onSortChange({
      sortBy: field,
      sortOrder: currentSort.sortOrder || SortOrder.ASC,
    });
  };

  const handleSortOrderToggle = () => {
    onSortChange({
      sortBy: currentSort.sortBy || SortBy.STATUS,
      sortOrder: isAscending ? SortOrder.DESC : SortOrder.ASC,
    });
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Sort Field Dropdown */}
      <Menu as="div" className="relative inline-block text-left">
        <div>
          <Menu.Button className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
            {currentField.label}
            <ChevronDownIcon className="-mr-1 h-5 w-5 text-gray-400" aria-hidden="true" />
          </Menu.Button>
        </div>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 z-10 mt-2 w-36 origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <div className="py-1">
              {sortFields.map((field) => (
                <Menu.Item key={field.value}>
                  {({ active }) => (
                    <button
                      onClick={() => handleSortFieldChange(field.value)}
                      className={cn(
                        active ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
                        currentSort.sortBy === field.value && 'bg-blue-50 text-blue-700 font-medium',
                        'block w-full px-4 py-2 text-left text-sm'
                      )}
                    >
                      {field.label}
                    </button>
                  )}
                </Menu.Item>
              ))}
            </div>
          </Menu.Items>
        </Transition>
      </Menu>

      {/* Sort Order Toggle Button */}
      <button
        onClick={handleSortOrderToggle}
        className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        title={isAscending ? '昇順' : '降順'}
        aria-label={`並び順を${isAscending ? '降順' : '昇順'}に変更`}
      >
        <svg
          className={cn('h-4 w-4 transition-transform', {
            'rotate-180': !isAscending,
          })}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 15l7-7 7 7"
          />
        </svg>
      </button>
    </div>
  );
}
