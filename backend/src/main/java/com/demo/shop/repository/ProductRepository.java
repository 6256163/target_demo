package com.demo.shop.repository;

import com.demo.shop.entity.Product;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ProductRepository extends JpaRepository<Product, Long> {

    @Query(value = """
            SELECT p FROM Product p
            WHERE (:keyword IS NULL OR :keyword = '' OR LOWER(p.name) LIKE LOWER(CONCAT('%', :keyword, '%')))
              AND (:categoryId IS NULL OR p.categoryId = :categoryId)
            ORDER BY p.id ASC
            """,
            countQuery = """
            SELECT COUNT(p) FROM Product p
            WHERE (:keyword IS NULL OR :keyword = '' OR LOWER(p.name) LIKE LOWER(CONCAT('%', :keyword, '%')))
              AND (:categoryId IS NULL OR p.categoryId = :categoryId)
            """)
    Page<Product> search(@Param("keyword") String keyword,
                         @Param("categoryId") Long categoryId,
                         Pageable pageable);

    Page<Product> findByStatus(String status, Pageable pageable);

    List<Product> findByCategoryId(Long categoryId);

    /** 库存扣减（乐观锁依赖 @Version，由 service 层控制重试） */
    @Modifying
    @Query("UPDATE Product p SET p.stock = p.stock - :delta WHERE p.id = :id AND p.stock >= :delta")
    int deductStock(@Param("id") Long id, @Param("delta") int delta);
}
