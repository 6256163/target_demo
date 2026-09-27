package com.demo.shop.dto.response;

import com.demo.shop.entity.Category;

public record CategoryResponse(Long id, String name, String description, Integer sortOrder) {
    public static CategoryResponse from(Category c) {
        return new CategoryResponse(c.getId(), c.getName(), c.getDescription(), c.getSortOrder());
    }
}
